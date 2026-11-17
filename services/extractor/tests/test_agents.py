"""Unit tests for ``agents.py``: validators, model access, failure categories, source checks.

Every agent run here uses a ``FunctionModel`` or a ``TestModel`` passed to ``agent.run``,
so no test makes a network call (Requirement 18.1).

Covers Requirements 2.6, 3.1, 3.4, 4.1, 5.3 and 18.1.
"""

from __future__ import annotations

import ast
from pathlib import Path
from typing import Any

import pytest
from pydantic import ValidationError
from pydantic_ai.exceptions import (
    ContentFilterError,
    ModelAPIError,
    ModelAuthenticationError,
    ModelContextWindowExceededError,
    ModelQuotaExceededError,
    ModelRateLimitError,
    ModelRequestTimeout,
    ModelTimeoutError,
    RunTimedOut,
    UnexpectedModelBehavior,
    UsageLimitExceeded,
    UserError,
)
from pydantic_ai.messages import ModelMessage, ModelRequest, RetryPromptPart, ToolReturnPart
from pydantic_ai.models.google import GoogleModel
from pydantic_ai.models.function import AgentInfo
from pydantic_ai.models.test import TestModel

from services.extractor import agents
from services.extractor.agents import (
    UNKNOWN_DOC_TYPE,
    ClassifyDeps,
    GeminiModelProvider,
    MapperDeps,
    ModelNotConfigured,
    ReaderDeps,
    classifier_agent,
    classify_failure,
    mapper_agent,
    reader_agent,
)
from services.extractor.config import get_settings
from services.extractor.models import Mapping, MapperOutput, PageRead
from services.extractor.pdf_text import open_pdf

from .conftest import ModelScript, make_function_model
from .factories import image_only_pdf, text_pdf

PACKAGE_DIR = Path(__file__).resolve().parents[1]

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _field(label: str, value_text: str, source_text: str | None = None) -> dict[str, Any]:
    return {
        "label": label,
        "value_text": value_text,
        "unit_as_printed": "t",
        "period_text": "",
        "source_text": source_text or f"{label} {value_text}",
        "confidence": 0.9,
    }


def _page_read(*fields: dict[str, Any]) -> dict[str, Any]:
    return {"page_period_text": "", "fields": list(fields)}


def _text_page() -> Any:
    """Page 1 of a PDF whose text layer holds ``Clinker production 150,000 t``."""
    data = text_pdf(["Clinker production 150,000 t", "Grid import 3,000,000 kWh"])
    with open_pdf(data, max_pages=5) as doc:
        return doc.page(1)


def _scanned_page() -> Any:
    with open_pdf(image_only_pdf(1), max_pages=5) as doc:
        page = doc.page(1)
    assert page.is_scanned
    return page


def _retry_messages(messages: list[ModelMessage]) -> list[str]:
    """The text of every retry message the validator sent back to the model.\n\n    pydantic-ai 2.67 returns an output-validator retry as a tool return part.\n    """
    out: list[str] = []
    for message in messages:
        if isinstance(message, ModelRequest):
            for part in message.parts:
                if isinstance(part, (RetryPromptPart, ToolReturnPart)):
                    out.append(str(part.content))
    return out


def _scripted(sequence: list[dict[str, Any]]) -> ModelScript:
    """A script that answers with ``sequence`` in order and repeats the last answer."""
    script = ModelScript()

    def handler(_messages: list[ModelMessage], _info: AgentInfo) -> dict[str, Any]:
        return sequence[min(len(script.calls) - 1, len(sequence) - 1)]

    script.handler = handler
    return script


# ---------------------------------------------------------------------------
# Reader_Agent output validator (Requirement 5.3, 5.4)
# ---------------------------------------------------------------------------


def test_reader_retries_when_a_number_is_absent_from_the_text_layer() -> None:
    wrong = _page_read(_field("Clinker production", "150,500"))
    right = _page_read(_field("Clinker production", "150,000"))
    script = _scripted([wrong, right])

    result = reader_agent.run_sync(
        "page", deps=ReaderDeps(page=_text_page()), model=make_function_model(script)
    )

    assert len(script.calls) == 2
    assert result.output.fields[0].value_text == "150,000"
    retries = _retry_messages(script.calls[1][0])
    assert len(retries) == 1
    assert "150,500" in retries[0]
    assert "Clinker production" in retries[0]


def test_reader_returns_the_output_after_the_retry_limit() -> None:
    wrong = _page_read(_field("Clinker production", "150,500"))
    script = _scripted([wrong])

    result = reader_agent.run_sync(
        "page", deps=ReaderDeps(page=_text_page()), model=make_function_model(script)
    )

    # One first attempt plus two output retries. The last attempt is returned, not raised.
    assert len(script.calls) == 3
    assert result.output.fields[0].value_text == "150,500"


def test_reader_accepts_a_number_in_another_format_without_retry() -> None:
    """Indian grouping of a Western-grouped number in the text layer is the same value."""
    script = _scripted([_page_read(_field("Clinker production", "1,50,000"))])

    reader_agent.run_sync(
        "page", deps=ReaderDeps(page=_text_page()), model=make_function_model(script)
    )

    assert len(script.calls) == 1


def test_reader_skips_non_numeric_values() -> None:
    script = _scripted([_page_read(_field("Plant name", "Shyamrock Cement Works"))])

    reader_agent.run_sync(
        "page", deps=ReaderDeps(page=_text_page()), model=make_function_model(script)
    )

    assert len(script.calls) == 1


def test_reader_does_not_retry_on_a_scanned_page() -> None:
    script = _scripted([_page_read(_field("Clinker production", "150,500"))])

    result = reader_agent.run_sync(
        "page", deps=ReaderDeps(page=_scanned_page()), model=make_function_model(script)
    )

    assert len(script.calls) == 1
    assert result.output.fields[0].value_text == "150,500"


def test_reader_does_not_retry_on_an_image_input() -> None:
    script = _scripted([_page_read(_field("Clinker production", "150,500"))])

    reader_agent.run_sync(
        "page", deps=ReaderDeps(page=None), model=make_function_model(script)
    )

    assert len(script.calls) == 1


# ---------------------------------------------------------------------------
# Mapper_Agent (Requirements 4.1, 4.3)
# ---------------------------------------------------------------------------


def _mapping(raw_id: str, stream_key: str | None = "coal_quantity") -> dict[str, Any]:
    return {"raw_id": raw_id, "stream_key": stream_key, "reason": "label match", "confidence": 0.8}


def test_mapper_runs_with_test_model_custom_output() -> None:
    model = TestModel(custom_output_args={"mappings": [_mapping("Sheet1!B2")]})

    result = mapper_agent.run_sync(
        "items", deps=MapperDeps(sent_ids=frozenset({"Sheet1!B2"})), model=model
    )

    assert result.output.mappings == [
        Mapping(raw_id="Sheet1!B2", stream_key="coal_quantity", reason="label match", confidence=0.8)
    ]


def test_mapper_retries_for_a_raw_id_that_was_not_sent() -> None:
    script = _scripted(
        [
            {"mappings": [_mapping("Sheet1!B2"), _mapping("Sheet1!Z99")]},
            {"mappings": [_mapping("Sheet1!B2")]},
        ]
    )

    result = mapper_agent.run_sync(
        "items",
        deps=MapperDeps(sent_ids=frozenset({"Sheet1!B2"})),
        model=make_function_model(script),
    )

    assert len(script.calls) == 2
    assert [m.raw_id for m in result.output.mappings] == ["Sheet1!B2"]
    assert "Sheet1!Z99" in _retry_messages(script.calls[1][0])[0]


def test_mapper_returns_unknown_ids_after_the_retry_limit() -> None:
    """Code, not the validator, discards them with a warning (Requirement 4.3)."""
    script = _scripted([{"mappings": [_mapping("Sheet1!Z99")]}])

    result = mapper_agent.run_sync(
        "items",
        deps=MapperDeps(sent_ids=frozenset({"Sheet1!B2"})),
        model=make_function_model(script),
    )

    assert len(script.calls) == 3
    assert [m.raw_id for m in result.output.mappings] == ["Sheet1!Z99"]


def test_mapping_has_no_numeric_value_field() -> None:
    """Requirement 4.1: a mapping holds a raw id, a stream key, a reason and a confidence."""
    assert set(Mapping.model_fields) == {"raw_id", "stream_key", "reason", "confidence"}
    for name, info in Mapping.model_fields.items():
        if name != "confidence":
            assert info.annotation in (str, "str | None", str | None), name
    assert set(MapperOutput.model_fields) == {"mappings"}


def test_mapper_output_rejects_an_extra_numeric_value() -> None:
    with pytest.raises(ValidationError):
        Mapping.model_validate({**_mapping("Sheet1!B2"), "value": 1234})
    with pytest.raises(ValidationError):
        MapperOutput.model_validate({"mappings": [], "total": 5})


def test_mapper_rejects_a_model_answer_that_carries_a_number() -> None:
    """A model that returns a value field cannot get it past the output schema."""
    bad = {"mappings": [{**_mapping("Sheet1!B2"), "value": 1234}]}
    script = _scripted([bad])

    with pytest.raises(UnexpectedModelBehavior):
        mapper_agent.run_sync(
            "items",
            deps=MapperDeps(sent_ids=frozenset({"Sheet1!B2"})),
            model=make_function_model(script),
        )


# ---------------------------------------------------------------------------
# Classifier agent
# ---------------------------------------------------------------------------


def _classification(doc_type: str) -> dict[str, Any]:
    return {"doc_type": doc_type, "confidence": 0.7, "reasoning": "title line"}


def test_classifier_accepts_an_allowed_type() -> None:
    script = _scripted([_classification("form_sb")])

    result = classifier_agent.run_sync(
        "page", deps=ClassifyDeps(allowed=frozenset({"form_sb"})), model=make_function_model(script)
    )

    assert result.output.doc_type == "form_sb"
    assert len(script.calls) == 1


def test_classifier_accepts_unknown() -> None:
    script = _scripted([_classification(UNKNOWN_DOC_TYPE)])

    result = classifier_agent.run_sync(
        "page", deps=ClassifyDeps(allowed=frozenset({"form_sb"})), model=make_function_model(script)
    )

    assert result.output.doc_type == UNKNOWN_DOC_TYPE
    assert len(script.calls) == 1


def test_classifier_retries_then_corrects_a_type_outside_the_list() -> None:
    script = _scripted([_classification("invented"), _classification("form_sb")])

    result = classifier_agent.run_sync(
        "page", deps=ClassifyDeps(allowed=frozenset({"form_sb"})), model=make_function_model(script)
    )

    assert len(script.calls) == 2
    assert result.output.doc_type == "form_sb"


def test_classifier_falls_back_to_unknown_after_the_retry_limit() -> None:
    script = _scripted([_classification("invented")])

    result = classifier_agent.run_sync(
        "page", deps=ClassifyDeps(allowed=frozenset({"form_sb"})), model=make_function_model(script)
    )

    assert len(script.calls) == 3
    assert result.output.doc_type == UNKNOWN_DOC_TYPE
    assert result.output.confidence == 0.0


# ---------------------------------------------------------------------------
# Agent construction (Requirements 3.1, 3.4)
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("agent", [reader_agent, mapper_agent, classifier_agent])
def test_agents_are_built_without_a_model(agent: Any) -> None:
    assert agent.model is None


def test_running_an_agent_without_a_model_fails_instead_of_falling_back() -> None:
    with pytest.raises(UserError):
        mapper_agent.run_sync("items", deps=MapperDeps(sent_ids=frozenset()))


def test_agent_instructions_are_static_strings() -> None:
    assert isinstance(agents.READER_INSTRUCTIONS, str)
    assert isinstance(agents.MAPPER_INSTRUCTIONS, str)
    assert isinstance(agents.CLASSIFIER_INSTRUCTIONS, str)
    assert "no numeric value" in agents.MAPPER_INSTRUCTIONS.lower() or "never return" in (
        agents.MAPPER_INSTRUCTIONS.lower()
    )


def test_page_read_fields_come_from_the_model_as_text() -> None:
    """The Reader_Agent hands back ``value_text`` as printed, not a parsed number."""
    page_read = PageRead.model_validate(_page_read(_field("Coal", "1,23,456.50")))
    assert page_read.fields[0].value_text == "1,23,456.50"
    assert isinstance(page_read.fields[0].value_text, str)


# ---------------------------------------------------------------------------
# GeminiModelProvider (Requirements 3.1, 3.3)
# ---------------------------------------------------------------------------


def test_provider_names_the_missing_key() -> None:
    provider = GeminiModelProvider(get_settings())
    with pytest.raises(ModelNotConfigured, match="GEMINI_API_KEY"):
        provider.get()


def test_provider_builds_a_gemini_model_with_the_configured_name(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("GEMINI_API_KEY", "not-a-real-key")
    monkeypatch.setenv("EXTRACTOR_MODEL", "gemini-test-model")

    model = GeminiModelProvider(get_settings()).get()

    assert isinstance(model, GoogleModel)
    assert model.model_name == "gemini-test-model"


def test_provider_uses_the_default_model_when_the_setting_is_empty(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("GEMINI_API_KEY", "not-a-real-key")
    monkeypatch.setenv("EXTRACTOR_MODEL", "")

    model = GeminiModelProvider(get_settings()).get()

    assert model.model_name == "gemini-2.5-flash"


# ---------------------------------------------------------------------------
# classify_failure (Requirement 3.5)
# ---------------------------------------------------------------------------


def test_classify_failure_maps_each_category() -> None:
    cases: list[tuple[BaseException, str]] = [
        (ModelAuthenticationError("model", "m"), "model_auth"),
        (ModelRateLimitError("model", "m"), "rate_limited"),
        (ModelQuotaExceededError("model", "m"), "rate_limited"),
        (ModelTimeoutError("model", "m"), "timeout"),
        (ModelRequestTimeout("model", 5.0), "timeout"),
        (RunTimedOut("m"), "timeout"),
        (ModelContextWindowExceededError("model", "m"), "input_too_large"),
        (ContentFilterError("m"), "content_filtered"),
        (UnexpectedModelBehavior("m"), "invalid_model_output"),
        (UsageLimitExceeded("m"), "usage_limit"),
        (ModelAPIError("model", "m"), "upstream_error"),
    ]
    for exc, expected in cases:
        assert classify_failure(exc) == expected, type(exc).__name__


def test_classify_failure_returns_none_for_other_exceptions() -> None:
    assert classify_failure(ValueError("x")) is None
    assert classify_failure(KeyError("x")) is None


def test_classify_failure_never_returns_the_exception_text() -> None:
    category = classify_failure(ModelAuthenticationError("model", "api-key-123 leaked"))
    assert category == "model_auth"
    assert "api-key-123" not in category


# ---------------------------------------------------------------------------
# Source checks (Requirements 2.6, 3.4)
# ---------------------------------------------------------------------------


def _package_sources() -> list[Path]:
    return [
        p
        for p in PACKAGE_DIR.rglob("*.py")
        if "tests" not in p.relative_to(PACKAGE_DIR).parts and "__pycache__" not in p.parts
    ]


def test_no_module_outside_tests_imports_test_model() -> None:
    offenders: list[str] = []
    for path in _package_sources():
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom):
                names = [node.module or "", *(a.name for a in node.names)]
            elif isinstance(node, ast.Import):
                names = [a.name for a in node.names]
            elif isinstance(node, ast.Name) and node.id == "TestModel":
                names = ["TestModel"]
            elif isinstance(node, ast.Attribute) and node.attr == "TestModel":
                names = ["TestModel"]
            else:
                continue
            if any(n == "TestModel" or n.endswith("models.test") for n in names):
                offenders.append(f"{path.name}:{node.lineno}")
    assert _package_sources(), "no package sources found"
    assert not offenders, offenders


def test_no_module_outside_tests_imports_function_model() -> None:
    offenders: list[str] = []
    for path in _package_sources():
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom):
                names = [node.module or "", *(a.name for a in node.names)]
            elif isinstance(node, ast.Import):
                names = [a.name for a in node.names]
            else:
                continue
            if any(n == "FunctionModel" or n.endswith("models.function") for n in names):
                offenders.append(f"{path.name}:{node.lineno}")
    assert not offenders, offenders


def test_api_compares_the_key_with_hmac_compare_digest() -> None:
    source = (PACKAGE_DIR / "api.py").read_text(encoding="utf-8")
    tree = ast.parse(source)

    imports_hmac = any(
        isinstance(n, ast.Import) and any(a.name == "hmac" for a in n.names)
        for n in ast.walk(tree)
    )
    calls = [
        n
        for n in ast.walk(tree)
        if isinstance(n, ast.Call)
        and isinstance(n.func, ast.Attribute)
        and n.func.attr == "compare_digest"
        and isinstance(n.func.value, ast.Name)
        and n.func.value.id == "hmac"
    ]
    assert imports_hmac
    assert calls, "api.py never calls hmac.compare_digest"


def test_api_never_compares_the_key_with_equality() -> None:
    """No ``==`` or ``!=`` involving the configured key (constant-time comparison only)."""
    tree = ast.parse((PACKAGE_DIR / "api.py").read_text(encoding="utf-8"))
    offenders: list[int] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Compare) and any(
            isinstance(op, (ast.Eq, ast.NotEq)) for op in node.ops
        ):
            if "extractor_api_key" in ast.unparse(node):
                offenders.append(node.lineno)
    assert not offenders, offenders


