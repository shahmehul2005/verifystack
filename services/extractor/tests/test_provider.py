"""Provider selection (Requirement 21): gemini and anthropic.

No test touches the network. Both providers run through an injected ``FunctionModel`` or
``TestModel``, and the real provider classes only build a model object (no request).
"""
from __future__ import annotations

import ast
import asyncio
import json
from pathlib import Path
from typing import Any

import anthropic
import httpx
import pytest
from fastapi.testclient import TestClient
from pydantic_ai import BinaryContent
from pydantic_ai.exceptions import ModelHTTPError, ModelRateLimitError
from pydantic_ai.messages import ModelMessage
from pydantic_ai.models.anthropic import AnthropicModel
from pydantic_ai.models.anthropic._errors import map_api_errors
from pydantic_ai.models.function import AgentInfo
from pydantic_ai.models.google import GoogleModel
from pydantic_ai.models.test import TestModel

from services.extractor import cli
from services.extractor.agents import (
    AnthropicModelProvider,
    GeminiModelProvider,
    ModelNotConfigured,
    build_model_provider,
    classify_failure,
)
from services.extractor.api import app, get_model_provider
from services.extractor.config import DEFAULT_MODEL, get_settings
from services.extractor.models import CalendarParams, DocTypeOption
from services.extractor.pipeline import (
    ModelFailure,
    PipelineDeps,
    Upload,
    classify,
    extract_calendar,
)

from .conftest import FixedModelProvider, ModelScript, make_function_model
from .factories import image_only_pdf, text_pdf
from .test_api import CATALOGUE, DOC_TYPES, NEEDS_MODEL, error_of, post_calendar

PDF_TYPE = "application/pdf"
PROVIDERS = ["gemini", "anthropic"]
PACKAGE_DIR = Path(__file__).resolve().parents[1]
FY = "FY2023-24"


# ---------------------------------------------------------------------------
# Selection and defaults (21.1, 21.3, 21.4, 21.5)
# ---------------------------------------------------------------------------
def test_empty_provider_selects_gemini_with_its_default_model() -> None:
    settings = get_settings()
    assert settings.provider == "gemini"
    assert settings.model == "gemini-2.5-flash" == DEFAULT_MODEL["gemini"]
    assert isinstance(build_model_provider(settings), GeminiModelProvider)


def test_anthropic_selects_its_provider_and_default_model(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("EXTRACTOR_PROVIDER", "anthropic")
    settings = get_settings()
    assert settings.model == "claude-haiku-5-5" == DEFAULT_MODEL["anthropic"]
    assert isinstance(build_model_provider(settings), AnthropicModelProvider)


def test_provider_value_ignores_case_and_surrounding_space(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("EXTRACTOR_PROVIDER", "  Anthropic ")
    assert get_settings().provider == "anthropic"


@pytest.mark.parametrize("provider", PROVIDERS)
def test_extractor_model_overrides_the_default_for_either_provider(
    monkeypatch: pytest.MonkeyPatch, provider: str
) -> None:
    monkeypatch.setenv("EXTRACTOR_PROVIDER", provider)
    monkeypatch.setenv("EXTRACTOR_MODEL", "custom-model")
    assert get_settings().model == "custom-model"


def test_providers_build_their_own_model_class_when_the_key_is_set(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("GEMINI_API_KEY", "g-key")
    assert isinstance(build_model_provider(get_settings()).get(), GoogleModel)
    monkeypatch.setenv("EXTRACTOR_PROVIDER", "anthropic")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "a-key")
    model = build_model_provider(get_settings()).get()
    assert isinstance(model, AnthropicModel)
    assert model.model_name == "claude-haiku-5-5"


# ---------------------------------------------------------------------------
# Missing key and unknown provider, with no fallback model (21.2, 21.6)
# ---------------------------------------------------------------------------
def test_anthropic_without_key_raises_naming_anthropic_api_key(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("EXTRACTOR_PROVIDER", "anthropic")
    monkeypatch.setenv("GEMINI_API_KEY", "g-key")  # the other provider's key does not count
    with pytest.raises(ModelNotConfigured, match="ANTHROPIC_API_KEY"):
        build_model_provider(get_settings()).get()


def test_gemini_without_key_raises_naming_gemini_api_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ANTHROPIC_API_KEY", "a-key")
    with pytest.raises(ModelNotConfigured, match="GEMINI_API_KEY"):
        build_model_provider(get_settings()).get()


def test_unknown_provider_raises_naming_extractor_provider(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("EXTRACTOR_PROVIDER", "openai")
    with pytest.raises(ModelNotConfigured, match="EXTRACTOR_PROVIDER"):
        build_model_provider(get_settings())


@pytest.fixture
def real_provider(client: TestClient) -> TestClient:
    """The client with the injected model removed, so the real provider selection answers."""
    app.dependency_overrides.pop(get_model_provider, None)
    return client


def _model_endpoints(headers: dict[str, str]) -> list[Any]:
    """One call to each model endpoint, as ``(name, callable(client))``."""
    pdf = text_pdf(["Invoice 123"])
    return [
        (
            "classify",
            lambda c: c.post(
                "/v1/classify",
                headers=headers,
                files={"file": ("doc.pdf", pdf, PDF_TYPE)},
                data={"allowed_doc_types": DOC_TYPES},
            ),
        ),
        (
            "extract-fields",
            lambda c: c.post(
                "/v1/extract-fields",
                headers=headers,
                files={"file": ("doc.pdf", pdf, PDF_TYPE)},
                data={"doc_type": "invoice", "catalogue": CATALOGUE},
            ),
        ),
        ("extract-calendar", lambda c: post_calendar(c, headers, NEEDS_MODEL)),
    ]


def test_anthropic_without_key_returns_503_naming_anthropic_api_key_on_every_model_endpoint(
    real_provider: TestClient, auth_headers: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("EXTRACTOR_PROVIDER", "anthropic")
    monkeypatch.setenv("GEMINI_API_KEY", "g-secret-value")
    for name, call in _model_endpoints(auth_headers):
        response = call(real_provider)
        assert response.status_code == 503, name
        message = error_of(response)["message"]
        assert "ANTHROPIC_API_KEY" in message, name
        assert "GEMINI_API_KEY" not in message, name
        assert "g-secret-value" not in response.text, name
        assert "readings" not in response.json(), name  # no fallback model made up output


def test_gemini_without_key_still_names_gemini_api_key(
    real_provider: TestClient, auth_headers: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("ANTHROPIC_API_KEY", "a-secret-value")
    for name, call in _model_endpoints(auth_headers):
        response = call(real_provider)
        assert response.status_code == 503, name
        assert "GEMINI_API_KEY" in error_of(response)["message"], name
        assert "a-secret-value" not in response.text, name


def test_unknown_provider_returns_503_naming_extractor_provider_on_every_model_endpoint(
    real_provider: TestClient, auth_headers: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("EXTRACTOR_PROVIDER", "openai")
    monkeypatch.setenv("GEMINI_API_KEY", "g-key")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "a-key")
    for name, call in _model_endpoints(auth_headers):
        response = call(real_provider)
        assert response.status_code == 503, name
        message = error_of(response)["message"]
        assert "EXTRACTOR_PROVIDER" in message, name
        assert "g-key" not in response.text and "a-key" not in response.text, name


# ---------------------------------------------------------------------------
# /health (21.7, 21.8)
# ---------------------------------------------------------------------------
def test_health_defaults_to_gemini(client: TestClient) -> None:
    body = client.get("/health").json()
    assert body["provider"] == "gemini"
    assert body["model"] == "gemini-2.5-flash"
    assert body["model_configured"] is False
    assert body["gemini_configured"] is False


def test_health_for_anthropic_follows_the_anthropic_key(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("EXTRACTOR_PROVIDER", "anthropic")
    body = client.get("/health").json()
    assert (body["provider"], body["model"]) == ("anthropic", "claude-haiku-5-5")
    assert body["model_configured"] is False
    monkeypatch.setenv("ANTHROPIC_API_KEY", "a-secret-value")
    response = client.get("/health")
    assert response.json()["model_configured"] is True
    assert response.json()["gemini_configured"] is False
    assert "a-secret-value" not in response.text


def test_gemini_configured_keeps_its_meaning_when_anthropic_is_selected(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("EXTRACTOR_PROVIDER", "anthropic")
    monkeypatch.setenv("GEMINI_API_KEY", "g-secret-value")
    response = client.get("/health")
    body = response.json()
    assert body["gemini_configured"] is True
    assert body["model_configured"] is False
    assert "g-secret-value" not in response.text


def test_health_for_gemini_with_key(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GEMINI_API_KEY", "g-key")
    body = client.get("/health").json()
    assert body["gemini_configured"] is True
    assert body["model_configured"] is True


def test_health_for_an_unknown_provider_is_not_configured(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("EXTRACTOR_PROVIDER", "openai")
    monkeypatch.setenv("GEMINI_API_KEY", "g-key")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "a-key")
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["provider"] == "openai"
    assert response.json()["model_configured"] is False


# ---------------------------------------------------------------------------
# Same behavior on both providers (21.9)
# ---------------------------------------------------------------------------
def _deps(provider: str, monkeypatch: pytest.MonkeyPatch, model: Any) -> PipelineDeps:
    monkeypatch.setenv("EXTRACTOR_PROVIDER", provider)
    return PipelineDeps(get_settings(), FixedModelProvider(model))


def _strip_run(body: dict[str, Any]) -> dict[str, Any]:
    run = {
        k: v for k, v in body["run"].items() if k not in ("input_hash", "model", "provider", "duration_ms")
    }
    return {**body, "run": run}


def _asdict(response: Any) -> dict[str, Any]:
    return json.loads(response.model_dump_json())


def _classify_with(provider: str, monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    model = TestModel(
        custom_output_args={"doc_type": "invoice", "confidence": 0.9, "reasoning": "an invoice"}
    )
    deps = _deps(provider, monkeypatch, model)
    allowed = [DocTypeOption(id="invoice", label="Invoice")]
    result = asyncio.run(classify(Upload("a.pdf", text_pdf(["Invoice 1"])), allowed, deps))
    assert result.run.model == DEFAULT_MODEL[provider]
    return _strip_run(_asdict(result))


def test_classify_gives_the_same_result_on_both_providers(monkeypatch: pytest.MonkeyPatch) -> None:
    results = [_classify_with(p, monkeypatch) for p in PROVIDERS]
    assert results[0] == results[1]
    assert results[0]["classification"]["doc_type"] == "invoice"


def test_mapper_flow_gives_the_same_readings_on_both_providers(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    results = []
    for provider in PROVIDERS:
        script = ModelScript()
        deps = _deps(provider, monkeypatch, make_function_model(script))
        params = CalendarParams(compliance_year=FY)
        response = asyncio.run(extract_calendar(Upload("u.xlsx", NEEDS_MODEL), params, deps))
        assert response.run.model_calls >= 1  # the mapper ran
        assert script.calls
        results.append(_strip_run(_asdict(response)))
    assert results[0] == results[1]


def test_reader_sends_page_images_as_binary_content_on_both_providers(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    for provider in PROVIDERS:
        script = ModelScript()
        deps = _deps(provider, monkeypatch, make_function_model(script))
        params = CalendarParams(compliance_year=FY)
        asyncio.run(extract_calendar(Upload("scan.pdf", image_only_pdf(1)), params, deps))
        images = [
            item
            for messages, _ in script.calls
            for message in messages
            for part in getattr(message, "parts", [])
            for item in (getattr(part, "content", None) or [])
            if isinstance(item, BinaryContent)
        ]
        assert images, provider
        assert images[0].media_type.startswith("image/"), provider


def _rate_limited(_m: list[ModelMessage], _i: AgentInfo) -> dict[str, Any]:
    raise ModelHTTPError.for_category(
        ModelRateLimitError,
        status_code=429,
        model_name="m",
        body="secret-document-text sk-secret",
    )


@pytest.mark.parametrize("provider", PROVIDERS)
def test_a_failed_model_call_gives_the_same_category_on_both_providers(
    monkeypatch: pytest.MonkeyPatch, provider: str
) -> None:
    deps = _deps(provider, monkeypatch, make_function_model(ModelScript(handler=_rate_limited)))
    allowed = [DocTypeOption(id="invoice", label="Invoice")]
    with pytest.raises(ModelFailure) as caught:
        asyncio.run(classify(Upload("a.pdf", text_pdf(["Invoice 1"])), allowed, deps))
    assert caught.value.category == "rate_limited"
    assert "secret-document-text" not in str(caught.value)


@pytest.mark.parametrize("provider", PROVIDERS)
def test_a_failed_model_call_maps_to_the_same_502_on_both_providers(
    client: TestClient,
    model_script: ModelScript,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
    provider: str,
) -> None:
    monkeypatch.setenv("EXTRACTOR_PROVIDER", provider)
    model_script.handler = _rate_limited
    response = post_calendar(client, auth_headers, NEEDS_MODEL)
    assert response.status_code == 502
    error = error_of(response)
    assert (error["code"], error["category"]) == ("model_failure", "rate_limited")
    assert "secret-document-text" not in response.text and "sk-secret" not in response.text


# ---------------------------------------------------------------------------
# classify_failure for the Anthropic SDK errors, as pydantic-ai wraps them
# ---------------------------------------------------------------------------
_REQUEST = httpx.Request("POST", "https://api.anthropic.example/v1/messages")
_SECRET = "sk-ant-secret-key"


def _status_error(cls: type[anthropic.APIStatusError], status: int) -> anthropic.APIStatusError:
    response = httpx.Response(status, request=_REQUEST)
    return cls(_SECRET, response=response, body={"error": {"message": _SECRET}})


ANTHROPIC_CASES: list[tuple[str, Any, str]] = [
    ("401", lambda: _status_error(anthropic.AuthenticationError, 401), "model_auth"),
    ("403", lambda: _status_error(anthropic.PermissionDeniedError, 403), "model_auth"),
    ("429", lambda: _status_error(anthropic.RateLimitError, 429), "rate_limited"),
    ("500", lambda: _status_error(anthropic.InternalServerError, 500), "upstream_error"),
    ("503", lambda: _status_error(anthropic.InternalServerError, 503), "upstream_error"),
    ("529 overloaded", lambda: _status_error(anthropic.InternalServerError, 529), "upstream_error"),
    ("timeout", lambda: anthropic.APITimeoutError(request=_REQUEST), "timeout"),
    ("connection", lambda: anthropic.APIConnectionError(request=_REQUEST), "upstream_error"),
]


@pytest.mark.parametrize(("label", "build", "expected"), ANTHROPIC_CASES, ids=[c[0] for c in ANTHROPIC_CASES])
def test_anthropic_sdk_errors_classify_to_a_category_without_leaking_text(
    label: str, build: Any, expected: str
) -> None:
    with pytest.raises(Exception) as caught:  # noqa: PT011 - any wrapped type
        with map_api_errors("claude-haiku-5-5"):
            raise build()
    category = classify_failure(caught.value)
    assert category == expected, label
    assert _SECRET not in category


# ---------------------------------------------------------------------------
# CLI (21.2, 21.6)
# ---------------------------------------------------------------------------
def _cli_extract(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> tuple[int, dict[str, Any]]:
    path = tmp_path / "needs_model.xlsx"
    path.write_bytes(NEEDS_MODEL)
    code = cli.main(["extract", str(path), "--year", FY])
    return code, json.loads(capsys.readouterr().out)


@pytest.mark.parametrize(
    ("env", "named"),
    [
        ({}, "GEMINI_API_KEY"),
        ({"EXTRACTOR_PROVIDER": "anthropic"}, "ANTHROPIC_API_KEY"),
        ({"EXTRACTOR_PROVIDER": "openai"}, "EXTRACTOR_PROVIDER"),
    ],
)
def test_cli_extract_names_the_setting_to_fix(
    tmp_path: Path,
    capsys: pytest.CaptureFixture[str],
    monkeypatch: pytest.MonkeyPatch,
    env: dict[str, str],
    named: str,
) -> None:
    for key, value in env.items():
        monkeypatch.setenv(key, value)
    code, body = _cli_extract(tmp_path, capsys)
    assert code == 1
    assert body["ok"] is False
    assert named in body["error"]["message"]
    others = {"GEMINI_API_KEY", "ANTHROPIC_API_KEY", "EXTRACTOR_PROVIDER"} - {named}
    assert not any(o in body["error"]["message"] for o in others)


def test_cli_builds_the_provider_with_build_model_provider() -> None:
    tree = ast.parse((PACKAGE_DIR / "cli.py").read_text(encoding="utf-8"))
    names = {n.id for n in ast.walk(tree) if isinstance(n, ast.Name)}
    assert "build_model_provider" in names
    assert "GeminiModelProvider" not in names


# ---------------------------------------------------------------------------
# No test model in production code (3.4)
# ---------------------------------------------------------------------------
def test_no_production_module_imports_test_or_function_model() -> None:
    sources = [
        p
        for p in PACKAGE_DIR.rglob("*.py")
        if "tests" not in p.relative_to(PACKAGE_DIR).parts and "__pycache__" not in p.parts
    ]
    assert sources
    offenders: list[str] = []
    for path in sources:
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
            if isinstance(node, ast.ImportFrom):
                names = [node.module or "", *(a.name for a in node.names)]
            elif isinstance(node, ast.Import):
                names = [a.name for a in node.names]
            else:
                continue
            if any(
                n in ("TestModel", "FunctionModel") or n.endswith(("models.test", "models.function"))
                for n in names
            ):
                offenders.append(f"{path.name}:{node.lineno}")
    assert not offenders, offenders

