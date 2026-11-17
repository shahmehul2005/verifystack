"""Property 6: Values come from the source and invalid mappings are discarded.

For any parsed source and any mapper output that mixes valid mappings, unknown raw ids and
stream keys outside the enum, every emitted Reading has the value read from its source cell,
every invalid mapping is dropped with exactly one warning, and no number written by the
model appears in any Reading.

Two levels are checked. ``resolve_mappings`` is driven directly with generated outputs, and
``extract_calendar`` is driven end to end with a ``FunctionModel`` that answers with the same
kind of mixed output.

**Validates: Requirements 4.2, 4.3, 4.4, 4.5**
"""

from __future__ import annotations

import asyncio
import json
from collections import Counter
from decimal import Decimal
from typing import Any

from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st
from pydantic_ai.messages import ModelMessage
from pydantic_ai.models.function import AgentInfo

from services.extractor.config import get_settings
from services.extractor.models import (
    BEEPATSectorStream,
    CalendarParams,
    DataCell,
    LabelItem,
    Mapping,
    MapperOutput,
    Period,
)
from services.extractor.pipeline import (
    PipelineDeps,
    Upload,
    extract_calendar,
    resolve_mappings,
)
from services.extractor.tests.conftest import FixedModelProvider, ModelScript, make_function_model
from services.extractor.tests.factories import decimals, long_table
from services.extractor.units import STANDARD_UNIT

STREAM_VALUES = [s.value for s in BEEPATSectorStream]
# Streams whose standard unit is tonnes, so a "t" cell converts without changing its value.
MASS_STREAMS = [s.value for s in BEEPATSectorStream if STANDARD_UNIT[s] == "t"]

MONTHLY = Period(kind="monthly", month_key="2023-04")

# A number the model "writes". Source values are drawn well below it and never equal it, so
# finding it in a Reading means a model number leaked through.
MODEL_NUMBER = "987654321.125"
MODEL_REASON = f"looks like {MODEL_NUMBER} tonnes, trust me"


# ---------------------------------------------------------------------------
# Strategies
# ---------------------------------------------------------------------------

# Text that is not a stream key: arbitrary text, a known key in the wrong case, or a known
# key with stray whitespace. The enum check is exact.
invalid_stream_keys = st.one_of(
    st.text(max_size=30),
    st.sampled_from(STREAM_VALUES).map(str.upper),
    st.sampled_from(STREAM_VALUES).map(lambda v: f" {v} "),
    st.sampled_from(STREAM_VALUES).map(lambda v: v + "_x"),
).filter(lambda s: s not in STREAM_VALUES)

valid_stream_keys = st.sampled_from(STREAM_VALUES)

# What the model does with one sent item.
#   ("valid", key) | ("invalid", text) | ("null", None) | ("absent", None)
item_decisions = st.one_of(
    valid_stream_keys.map(lambda k: ("valid", k)),
    invalid_stream_keys.map(lambda t: ("invalid", t)),
    st.just(("null", None)),
    st.just(("absent", None)),
)

cell_values = st.one_of(decimals(max_int_digits=7, max_places=3), st.integers(1, 10**7))


@st.composite
def scenarios(draw: st.DrawFn) -> dict[str, Any]:
    """Sent items, the model's decision for each, and extra unknown raw ids."""
    n = draw(st.integers(min_value=0, max_value=8))
    items: list[LabelItem] = []
    for i in range(n):
        raws = draw(st.lists(cell_values, min_size=1, max_size=3))
        items.append(
            LabelItem(
                raw_id=f"Sheet1!A{i + 2}",
                label=f"Zzq item {i}",
                sheet="Sheet1",
                cells=[
                    DataCell(sheet="Sheet1", cell=f"{'CDE'[j]}{i + 2}", raw=v, period=MONTHLY)
                    for j, v in enumerate(raws)
                ],
            )
        )
    decisions = [draw(item_decisions) for _ in items]
    unknown_count = draw(st.integers(min_value=0, max_value=4))
    unknown = [
        (f"Other!{'XYZ'[draw(st.integers(0, 2))]}{k + 1}", draw(st.one_of(valid_stream_keys, invalid_stream_keys)))
        for k in range(unknown_count)
    ]
    mappings: list[tuple[str, str | None]] = []
    for it, (kind, key) in zip(items, decisions, strict=True):
        if kind != "absent":
            mappings.append((it.raw_id, key))
    mappings.extend(unknown)
    order = draw(st.permutations(range(len(mappings))))
    mappings = [mappings[i] for i in order]
    return {
        "items": items,
        "decisions": decisions,
        "mappings": mappings,
        "unknown_ids": {r for r, _ in unknown},
    }


def _snapshot(items: list[LabelItem]) -> list[list[Any]]:
    return [[c.raw for c in it.cells] for it in items]


# ---------------------------------------------------------------------------
# resolve_mappings
# ---------------------------------------------------------------------------


@settings(max_examples=200, deadline=None)
@given(scenarios())
def test_resolve_mappings_keeps_source_values_and_discards_invalid(scenario: dict[str, Any]) -> None:
    items: list[LabelItem] = scenario["items"]
    sent = {it.raw_id: it for it in items}
    before = _snapshot(items)
    output = MapperOutput(
        mappings=[
            Mapping(raw_id=r, stream_key=k, reason=MODEL_REASON, confidence=0.5)
            for r, k in scenario["mappings"]
        ]
    )

    resolved, warnings = resolve_mappings(output, sent)

    # Expected: valid mappings, in the order the model returned them.
    decision_by_id = {it.raw_id: d for it, d in zip(items, scenario["decisions"], strict=True)}
    expected_valid = [
        (r, k)
        for r, k in scenario["mappings"]
        if r in decision_by_id and decision_by_id[r][0] == "valid"
    ]
    assert [(it.raw_id, s.value) for it, s in resolved] == expected_valid
    for it, _stream in resolved:
        assert it is sent[it.raw_id]  # the item parsed from the source, not a model copy

    # Every cell value is still the one the source held (Requirement 4.2).
    assert _snapshot(items) == before

    # Exactly one warning per invalid mapping, with the right code (Requirements 4.3, 4.4).
    expected_codes: Counter[str] = Counter()
    for r, k in scenario["mappings"]:
        if r in scenario["unknown_ids"]:
            expected_codes["mapping_unknown_raw_id"] += 1
        elif decision_by_id[r][0] == "invalid":
            expected_codes["mapping_invalid_stream"] += 1
    assert Counter(w.code for w in warnings) == expected_codes
    assert len(warnings) == sum(expected_codes.values())

    invalid_ids = {r for r, d in decision_by_id.items() if d[0] == "invalid"}
    assert {w.raw_id for w in warnings if w.code == "mapping_invalid_stream"} == invalid_ids

    # Nothing the model wrote is carried into the result.
    assert MODEL_NUMBER not in json.dumps([it.model_dump(mode="json") for it, _ in resolved])
    assert all(MODEL_NUMBER not in w.message for w in warnings)


# ---------------------------------------------------------------------------
# extract_calendar end to end
# ---------------------------------------------------------------------------

WORDS = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel"]


def _sent_items(messages: list[ModelMessage]) -> list[dict[str, Any]]:
    out: list[str] = []
    for message in messages:
        for part in getattr(message, "parts", []):
            content = getattr(part, "content", None)
            if isinstance(content, str):
                out.append(content)
            elif isinstance(content, (list, tuple)):
                out.extend(c for c in content if isinstance(c, str))
    text = "\n".join(out)
    return json.loads(text.split("Items (JSON):\n", 1)[1].splitlines()[0])


@st.composite
def calendar_scenarios(draw: st.DrawFn) -> list[tuple[str, int, tuple[str, str | None]]]:
    """``(label, source value, model decision)`` per leftover row."""
    n = draw(st.integers(min_value=1, max_value=len(WORDS)))
    words = draw(st.permutations(WORDS))[:n]
    rows = []
    for w in words:
        value = draw(st.integers(min_value=1, max_value=10**6))
        decision = draw(
            st.one_of(
                st.sampled_from(MASS_STREAMS).map(lambda k: ("valid", k)),
                invalid_stream_keys.map(lambda t: ("invalid", t)),
                st.just(("null", None)),
            )
        )
        rows.append((f"Zzq widget {w}", value, decision))
    return rows


@settings(
    max_examples=40,
    deadline=None,
    suppress_health_check=[HealthCheck.function_scoped_fixture],
)
@given(rows=calendar_scenarios(), unknown_count=st.integers(min_value=0, max_value=3))
def test_calendar_readings_use_source_values_and_invalid_mappings_warn_once(
    rows: list[tuple[str, int, tuple[str, str | None]]], unknown_count: int
) -> None:
    decisions = {label: decision for label, _v, decision in rows}

    def handler(messages: list[ModelMessage], _info: AgentInfo) -> dict[str, Any]:
        mappings: list[dict[str, Any]] = [
            {
                "raw_id": it["raw_id"],
                "stream_key": decisions[it["label"]][1],
                "reason": MODEL_REASON,
                "confidence": 0.9,
            }
            for it in _sent_items(messages)
        ]
        mappings.extend(
            {
                "raw_id": f"Nowhere!Q{k + 1}",
                "stream_key": MASS_STREAMS[0],
                "reason": MODEL_REASON,
                "confidence": 0.9,
            }
            for k in range(unknown_count)
        )
        return {"mappings": mappings}

    script = ModelScript(handler=handler)
    deps = PipelineDeps(get_settings(), FixedModelProvider(make_function_model(script)))
    data = long_table([("Apr-2023", label, value, "t") for label, value, _d in rows])
    result = asyncio.run(
        extract_calendar(
            Upload("upload.xlsx", data), CalendarParams(compliance_year="FY2023-24"), deps
        )
    )

    # The rows really were leftovers, so the model saw every one of them.
    assert script.calls, "the mapper was never called"
    assert {it["label"] for it in _sent_items(script.calls[0][0])} == set(decisions)

    value_by_label = {label: value for label, value, _d in rows}
    valid = {label for label, d in decisions.items() if d[0] == "valid"}
    invalid = {label for label, d in decisions.items() if d[0] == "invalid"}

    # One reading per valid mapping, its number taken from the source cell.
    assert len(result.readings) == len(valid)
    for reading in result.readings:
        assert reading.label in valid
        assert reading.stream_key.value == decisions[reading.label or ""][1]
        assert reading.value == float(value_by_label[reading.label or ""])
        assert reading.normalized_value == float(value_by_label[reading.label or ""])
        assert reading.provenance.sheet is not None and reading.provenance.cell is not None
    assert {r.label for r in result.readings} == valid

    # Every invalid mapping is dropped with exactly one warning.
    codes = Counter(w.code for w in result.warnings)
    assert codes["mapping_invalid_stream"] == len(invalid)
    assert codes["mapping_unknown_raw_id"] == unknown_count

    # Discarded and null-mapped labels stay unmapped.
    assert set(result.unmapped) == set(decisions) - valid

    # No number the model wrote reaches a Reading.
    assert MODEL_NUMBER not in json.dumps([r.model_dump(mode="json") for r in result.readings])


def test_decimal_cell_value_is_not_altered_by_resolution() -> None:
    """A fixed example: a Decimal source value stays exactly the same object content."""
    it = LabelItem(
        raw_id="Sheet1!A2",
        label="Zzq",
        sheet="Sheet1",
        cells=[DataCell(sheet="Sheet1", cell="C2", raw=Decimal("12.340"), period=MONTHLY)],
    )
    out = MapperOutput(
        mappings=[
            Mapping(raw_id="Sheet1!A2", stream_key="coal_quantity", reason=MODEL_REASON, confidence=1)
        ]
    )
    resolved, warnings = resolve_mappings(out, {it.raw_id: it})
    assert warnings == []
    assert resolved[0][0].cells[0].raw == Decimal("12.340")
