"""Unit tests for the pipeline (task 5.11).

Covers mapping resolution (Requirements 4.2, 4.3, 4.4), the rule that the Mapper_Agent
receives only leftover labels (9.3, 9.4), the model-needed rule (decision D4, 3.3), the
``layout_not_recognized`` path and the run block (17.4). The model is always a
``FunctionModel`` behind a ``FixedModelProvider``, so no test touches the network.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import Callable
from typing import Any

import pytest
from pydantic_ai.exceptions import ModelHTTPError, ModelRateLimitError
from pydantic_ai.messages import ModelMessage
from pydantic_ai.models import Model
from pydantic_ai.models.function import AgentInfo

from services.extractor.agents import (
    PROMPT_VERSION,
    GeminiModelProvider,
    ModelNotConfigured,
)
from services.extractor.config import get_settings
from services.extractor.models import (
    BEEPATSectorStream as S,
    CalendarParams,
    DataCell,
    LabelItem,
    Mapping,
    MapperOutput,
    Period,
    SourceType,
)
from services.extractor.pipeline import (
    LLM_CONFIDENCE_CAP,
    MAPPER_BATCH,
    LayoutNotRecognized,
    ModelFailure,
    PipelineDeps,
    RunState,
    Upload,
    build_reading,
    compute_input_hash,
    extract_calendar,
    is_regulatory,
    resolve_mappings,
    run_mapper,
)
from services.extractor.models import Reading, SkippedItem

from .conftest import FixedModelProvider, ModelScript, make_function_model
from .factories import long_table, proforma_workbook

FY = "FY2023-24"
MONTHLY = Period(kind="monthly", month_key="2023-04")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


class CountingProvider:
    """A provider that counts ``get`` calls. It raises, so a test fails if a model is asked for."""

    def __init__(self) -> None:
        self.requests = 0

    def get(self) -> Model:
        self.requests += 1
        raise AssertionError("a model was requested, but none should be needed")


def deps_for(script: ModelScript | None = None) -> PipelineDeps:
    provider = FixedModelProvider(make_function_model(script or ModelScript()))
    return PipelineDeps(get_settings(), provider)


def run(coro: Any) -> Any:
    return asyncio.run(coro)


def calendar(data: bytes, deps: PipelineDeps, **params: Any) -> Any:
    req = CalendarParams(compliance_year=params.pop("compliance_year", FY), **params)
    return run(extract_calendar(Upload("upload.xlsx", data), req, deps))


def user_text(messages: list[ModelMessage]) -> str:
    out: list[str] = []
    for message in messages:
        for part in getattr(message, "parts", []):
            content = getattr(part, "content", None)
            if isinstance(content, str):
                out.append(content)
            elif isinstance(content, (list, tuple)):
                out.extend(c for c in content if isinstance(c, str))
    return "\n".join(out)


def sent_items(messages: list[ModelMessage]) -> list[dict[str, Any]]:
    """The JSON item list the pipeline put in the mapper prompt."""
    text = user_text(messages)
    return json.loads(text.split("Items (JSON):\n", 1)[1].splitlines()[0])


def mapper_handler(
    choose: Callable[[dict[str, Any]], str | None], confidence: float = 0.95
) -> Callable[[list[ModelMessage], AgentInfo], dict[str, Any]]:
    """A handler that maps each sent item to ``choose(item)``."""

    def handler(messages: list[ModelMessage], info: AgentInfo) -> dict[str, Any]:
        return {
            "mappings": [
                {"raw_id": it["raw_id"], "stream_key": choose(it), "confidence": confidence}
                for it in sent_items(messages)
            ]
        }

    return handler


def item(raw_id: str = "Sheet1!A2", label: str = "Zzq widget", value: Any = 5) -> LabelItem:
    return LabelItem(
        raw_id=raw_id,
        label=label,
        sheet="Sheet1",
        cells=[DataCell(sheet="Sheet1", cell="C2", raw=value, period=MONTHLY)],
    )


def output(*mappings: tuple[str, str | None]) -> MapperOutput:
    return MapperOutput(
        mappings=[Mapping(raw_id=r, stream_key=s, confidence=0.9) for r, s in mappings]
    )


# One rule-mapped row and one row no rule can place.
MIXED = long_table(
    [
        ("Apr-2023", "coal_quantity", 100, "t"),
        ("Apr-2023", "Zzq widget throughput", 7, "t"),
    ]
)
ALL_RULES = long_table(
    [
        ("Apr-2023", "coal_quantity", 100, "t"),
        ("Apr-2023", "clinker_production", 5000, "t"),
    ]
)


# ---------------------------------------------------------------------------
# resolve_mappings (4.2, 4.3, 4.4)
# ---------------------------------------------------------------------------


def test_resolve_keeps_valid_mapping_and_the_cell_value_comes_from_the_source() -> None:
    sent = {"Sheet1!A2": item(value=123.5)}
    resolved, warnings = resolve_mappings(output(("Sheet1!A2", "coal_quantity")), sent)
    assert warnings == []
    assert len(resolved) == 1
    label_item, stream = resolved[0]
    assert stream is S.COAL_QUANTITY
    assert label_item.cells[0].raw == 123.5


def test_resolve_discards_unknown_raw_id_with_warning() -> None:
    sent = {"Sheet1!A2": item()}
    resolved, warnings = resolve_mappings(output(("Sheet1!Z99", "coal_quantity")), sent)
    assert resolved == []
    assert [w.code for w in warnings] == ["mapping_unknown_raw_id"]


def test_resolve_discards_invalid_stream_key_with_warning() -> None:
    sent = {"Sheet1!A2": item()}
    resolved, warnings = resolve_mappings(output(("Sheet1!A2", "plutonium_quantity")), sent)
    assert resolved == []
    assert [(w.code, w.raw_id) for w in warnings] == [("mapping_invalid_stream", "Sheet1!A2")]


def test_resolve_null_stream_key_is_unmapped_without_warning() -> None:
    sent = {"Sheet1!A2": item()}
    resolved, warnings = resolve_mappings(output(("Sheet1!A2", None)), sent)
    assert resolved == []
    assert warnings == []


def test_resolve_duplicate_raw_id_keeps_the_first() -> None:
    sent = {"Sheet1!A2": item()}
    resolved, warnings = resolve_mappings(
        output(("Sheet1!A2", "coal_quantity"), ("Sheet1!A2", "petcoke_quantity")), sent
    )
    assert [stream for _, stream in resolved] == [S.COAL_QUANTITY]
    assert [w.code for w in warnings] == ["mapping_duplicate"]


def test_mapper_output_has_no_numeric_field() -> None:
    """The model cannot return a number through the mapper (4.1, 4.2)."""
    with pytest.raises(ValueError):
        Mapping.model_validate(
            {"raw_id": "a", "stream_key": None, "confidence": 0.5, "value": 12.0}
        )


# ---------------------------------------------------------------------------
# run_mapper
# ---------------------------------------------------------------------------


def test_run_mapper_with_no_items_never_asks_for_a_model() -> None:
    provider = CountingProvider()
    deps = PipelineDeps(get_settings(), provider)
    state = RunState()
    outcome = run(run_mapper([], deps, state))
    assert provider.requests == 0
    assert state.model_calls == 0
    assert outcome.mapped == [] and outcome.unmapped == []


def test_run_mapper_sends_batches_of_at_most_the_batch_size() -> None:
    script = ModelScript(handler=mapper_handler(lambda _it: None))
    items = [item(raw_id=f"Sheet1!A{n}", label=f"Zzq widget {n}") for n in range(2, 2 + MAPPER_BATCH + 1)]
    state = RunState()
    outcome = run(run_mapper(items, deps_for(script), state))
    assert MAPPER_BATCH == 120
    assert state.model_calls == 2
    assert [len(sent_items(messages)) for messages, _ in script.calls] == [120, 1]
    assert len(outcome.unmapped) == MAPPER_BATCH + 1


def test_run_mapper_repeated_raw_id_is_sent_once_and_left_unmapped() -> None:
    script = ModelScript(handler=mapper_handler(lambda _it: "coal_quantity"))
    first, again = item(raw_id="Sheet1!A2"), item(raw_id="Sheet1!A2", label="Other")
    outcome = run(run_mapper([first, again], deps_for(script), RunState()))
    assert [len(sent_items(m)) for m, _ in script.calls] == [1]
    assert [it.label for it in outcome.unmapped] == ["Other"]
    assert len(outcome.mapped) == 1


def test_run_mapper_unanswered_item_stays_unmapped() -> None:
    script = ModelScript(handler=lambda _m, _i: {"mappings": []})
    outcome = run(run_mapper([item()], deps_for(script), RunState()))
    assert outcome.mapped == []
    assert [it.raw_id for it in outcome.unmapped] == ["Sheet1!A2"]


def test_run_mapper_missing_key_raises_model_not_configured() -> None:
    deps = PipelineDeps(get_settings(), GeminiModelProvider(get_settings()))
    with pytest.raises(ModelNotConfigured, match="GEMINI_API_KEY"):
        run(run_mapper([item()], deps, RunState()))


def test_run_mapper_model_failure_maps_to_category_without_exception_text() -> None:
    def boom(_m: list[ModelMessage], _i: AgentInfo) -> dict[str, Any]:
        raise ModelHTTPError.for_category(
            ModelRateLimitError,
            status_code=429,
            model_name="test-model",
            body="secret-document-text",
        )

    with pytest.raises(ModelFailure) as caught:
        run(run_mapper([item()], deps_for(ModelScript(handler=boom)), RunState()))
    assert caught.value.category == "rate_limited"
    assert "secret-document-text" not in str(caught.value)


# ---------------------------------------------------------------------------
# Model-needed rule (D4, 3.3) and leftover-only calls (9.3)
# ---------------------------------------------------------------------------


def test_no_leftover_labels_means_no_model_request() -> None:
    provider = CountingProvider()
    result = calendar(ALL_RULES, PipelineDeps(get_settings(), provider))
    assert provider.requests == 0
    assert result.run.model_calls == 0
    assert {r.stream_key for r in result.readings} == {S.COAL_QUANTITY, S.CLINKER_PRODUCTION}
    assert result.unmapped == []


def test_all_rule_mapped_file_works_with_the_real_provider_and_no_key() -> None:
    deps = PipelineDeps(get_settings(), GeminiModelProvider(get_settings()))
    result = calendar(ALL_RULES, deps)
    assert len(result.readings) == 2
    assert result.run.model_calls == 0


def test_leftover_label_without_key_raises_model_not_configured() -> None:
    deps = PipelineDeps(get_settings(), GeminiModelProvider(get_settings()))
    with pytest.raises(ModelNotConfigured):
        calendar(MIXED, deps)


def test_model_failure_fails_the_whole_request_with_no_partial_readings() -> None:
    def boom(_m: list[ModelMessage], _i: AgentInfo) -> dict[str, Any]:
        raise ModelHTTPError(500, "test-model", "upstream down")

    with pytest.raises(ModelFailure) as caught:
        calendar(MIXED, deps_for(ModelScript(handler=boom)))
    assert caught.value.category == "upstream_error"


def test_mapper_receives_only_the_leftover_label() -> None:
    script = ModelScript(handler=mapper_handler(lambda _it: None))
    result = calendar(MIXED, deps_for(script))
    assert len(script.calls) == 1
    items = sent_items(script.calls[0][0])
    assert [it["label"] for it in items] == ["Zzq widget throughput"]
    assert "coal_quantity" not in json.dumps(items)
    assert result.run.model_calls == 1
    assert result.unmapped == ["Zzq widget throughput"]
    # The rule-mapped row is still read.
    assert [r.stream_key for r in result.readings] == [S.COAL_QUANTITY]


def test_llm_mapped_reading_is_flagged_capped_and_takes_its_number_from_the_cell() -> None:
    script = ModelScript(handler=mapper_handler(lambda _it: "petcoke_quantity", confidence=0.99))
    result = calendar(MIXED, deps_for(script))
    by_stream = {r.stream_key: r for r in result.readings}
    llm = by_stream[S.PETCOKE_QUANTITY]
    assert llm.mapping_source == "llm"
    assert llm.needs_review is True
    assert "llm_mapped" in llm.review_reasons
    assert llm.confidence <= LLM_CONFIDENCE_CAP
    assert llm.value == 7.0  # the cell, not anything the model wrote
    assert llm.provenance.sheet is not None and llm.provenance.cell is not None
    rule = by_stream[S.COAL_QUANTITY]
    assert rule.mapping_source != "llm"
    assert "llm_mapped" not in rule.review_reasons
    assert result.unmapped == []


def test_invalid_stream_from_the_model_is_discarded_with_a_warning() -> None:
    script = ModelScript(handler=mapper_handler(lambda _it: "plutonium_quantity"))
    result = calendar(MIXED, deps_for(script))
    assert [r.stream_key for r in result.readings] == [S.COAL_QUANTITY]
    assert "mapping_invalid_stream" in [w.code for w in result.warnings]
    assert result.unmapped == ["Zzq widget throughput"]


def test_unknown_raw_id_from_the_model_is_discarded_with_a_warning() -> None:
    script = ModelScript(
        handler=lambda _m, _i: {
            "mappings": [{"raw_id": "Nope!Z9", "stream_key": "coal_quantity", "confidence": 1.0}]
        }
    )
    result = calendar(MIXED, deps_for(script))
    assert "mapping_unknown_raw_id" in [w.code for w in result.warnings]
    assert [r.stream_key for r in result.readings] == [S.COAL_QUANTITY]
    assert result.unmapped == ["Zzq widget throughput"]


# ---------------------------------------------------------------------------
# layout_not_recognized
# ---------------------------------------------------------------------------


def test_workbook_with_no_table_or_pro_forma_raises_layout_not_recognized() -> None:
    data = proforma_workbook([("Meeting notes", "see attached"), ("Next steps", "tbd")], sheet="Notes")
    provider = CountingProvider()
    with pytest.raises(LayoutNotRecognized):
        calendar(data, PipelineDeps(get_settings(), provider))
    assert provider.requests == 0


def test_layout_restriction_can_make_a_pro_forma_unrecognized() -> None:
    data = proforma_workbook(
        [("Clinker production (t)", 150000), ("Grid electricity (kWh)", 3000000)]
    )
    with pytest.raises(LayoutNotRecognized):
        calendar(data, deps_for(), layout="tabular")


# ---------------------------------------------------------------------------
# Run block (17.4)
# ---------------------------------------------------------------------------


def test_run_block_reports_model_prompt_version_and_a_sha256_hash() -> None:
    result = calendar(ALL_RULES, deps_for())
    assert result.run.model == get_settings().model
    assert result.run.prompt_version == PROMPT_VERSION
    assert len(result.run.input_hash) == 64
    int(result.run.input_hash, 16)
    assert result.run.duration_ms >= 0


def test_same_input_gives_the_same_input_hash() -> None:
    first = calendar(ALL_RULES, deps_for()).run.input_hash
    second = calendar(ALL_RULES, deps_for()).run.input_hash
    assert first == second


def test_input_hash_changes_with_file_year_source_type_and_model(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    base = calendar(ALL_RULES, deps_for()).run.input_hash
    other_file = long_table([("Apr-2023", "coal_quantity", 101, "t")])
    assert calendar(other_file, deps_for()).run.input_hash != base
    assert calendar(ALL_RULES, deps_for(), compliance_year="FY2024-25").run.input_hash != base
    assert (
        calendar(ALL_RULES, deps_for(), source_type=SourceType.PROFORMA).run.input_hash != base
    )
    monkeypatch.setenv("EXTRACTOR_MODEL", "another-model")
    assert calendar(ALL_RULES, deps_for()).run.input_hash != base


def test_compute_input_hash_ignores_parameter_key_order() -> None:
    a = compute_input_hash(["h1"], {"x": 1, "y": 2}, "m", "gemini")
    b = compute_input_hash(["h1"], {"y": 2, "x": 1}, "m", "gemini")
    assert a == b
    assert compute_input_hash(["h1", "h2"], {"x": 1, "y": 2}, "m", "gemini") != a


def test_file_info_carries_the_real_hash_and_a_safe_name() -> None:
    req = CalendarParams(compliance_year=FY)
    result = run(extract_calendar(Upload("C:\\temp\\..\\plant.xlsx", ALL_RULES), req, deps_for()))
    assert result.file.name == "plant.xlsx"
    assert result.file.format == "xlsx"
    assert result.file.size_bytes == len(ALL_RULES)
    import hashlib

    assert result.file.sha256 == hashlib.sha256(ALL_RULES).hexdigest()


def test_extension_mismatch_warns_and_the_file_is_still_read() -> None:
    req = CalendarParams(compliance_year=FY)
    result = run(extract_calendar(Upload("data.csv", ALL_RULES), req, deps_for()))
    assert "extension_mismatch" in [w.code for w in result.warnings]
    assert len(result.readings) == 2


def test_unparseable_compliance_year_warns() -> None:
    result = calendar(ALL_RULES, deps_for(), compliance_year="not a year")
    assert "fy_unparsed" in [w.code for w in result.warnings]


# ---------------------------------------------------------------------------
# build_reading
# ---------------------------------------------------------------------------


def cell(raw: Any, unit: str | None = None) -> DataCell:
    return DataCell(sheet="S", cell="B2", raw=raw, unit=unit, period=MONTHLY)


def test_build_reading_without_any_unit_assumes_the_standard_unit_and_flags_it() -> None:
    built = build_reading(
        item(label="Zzq widget"),
        cell(12),
        S.COAL_QUANTITY,
        mapping_source="phrase",
        source_type=SourceType.CORROBORATION,
        source="excel",
    )
    assert isinstance(built, Reading)
    assert built.unit_assumed is True
    assert built.needs_review is True
    assert "unit_assumed" in built.review_reasons
    assert built.unit_as_stated is None
    assert built.normalized_unit == "t"
    assert built.normalized_value == 12.0


def test_build_reading_converts_the_stated_unit() -> None:
    built = build_reading(
        item(label="Clinker"),
        cell("1.5", "Lakh t"),
        S.CLINKER_PRODUCTION,
        mapping_source="key",
        source_type=SourceType.PROFORMA,
        source="excel",
    )
    assert isinstance(built, Reading)
    assert built.value == 1.5
    assert built.normalized_value == 150000.0
    assert built.unit_assumed is False
    assert built.verified is True


def test_build_reading_incompatible_unit_is_skipped_as_not_convertible() -> None:
    built = build_reading(
        item(label="Coal"),
        cell(5, "kWh"),
        S.COAL_QUANTITY,
        mapping_source="key",
        source_type=SourceType.CORROBORATION,
        source="excel",
    )
    assert isinstance(built, SkippedItem)
    assert built.reason == "not_convertible"


def test_build_reading_text_value_is_skipped_as_value_unparsed() -> None:
    built = build_reading(
        item(),
        cell("n/a", "t"),
        S.COAL_QUANTITY,
        mapping_source="key",
        source_type=SourceType.CORROBORATION,
        source="excel",
    )
    assert isinstance(built, SkippedItem)
    assert built.reason == "value_unparsed"


def test_build_reading_without_a_period_is_skipped() -> None:
    no_period = DataCell(sheet="S", cell="B2", raw=5, unit="t")
    built = build_reading(
        item(),
        no_period,
        S.COAL_QUANTITY,
        mapping_source="key",
        source_type=SourceType.CORROBORATION,
        source="excel",
    )
    assert isinstance(built, SkippedItem)
    assert built.reason == "period_unresolved"


def test_build_reading_flags_regulatory_labels() -> None:
    built = build_reading(
        item(label="Coal emission factor"),
        cell(2.5, "t"),
        S.COAL_QUANTITY,
        mapping_source="key",
        source_type=SourceType.CORROBORATION,
        source="excel",
    )
    assert isinstance(built, Reading)
    assert built.regulatory is True
    assert "regulatory_value" in built.review_reasons


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("Emission factor", True),
        ("GWP of methane", True),
        ("Default value", True),
        ("Coal quantity", False),
        ("Target", True),
        ("Targeted dispatch", False),
        (None, False),
    ],
)
def test_is_regulatory(text: str | None, expected: bool) -> None:
    assert is_regulatory(text) is expected
