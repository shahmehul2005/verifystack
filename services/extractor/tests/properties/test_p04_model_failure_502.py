"""Property 4: Model failures map to 502 without readings.

For any exception raised by the model layer, the response is 502 ``model_failure``,
carries a ``category`` from the fixed set, and has no ``readings`` or ``fields``.

**Validates: Requirements 3.5**
"""

from __future__ import annotations

import json
from collections.abc import Callable
from typing import Any

import pytest
from fastapi.testclient import TestClient
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st
from pydantic_ai.exceptions import (
    ContentFilterError,
    ModelAPIError,
    ModelAuthenticationError,
    ModelConnectionError,
    ModelContextWindowExceededError,
    ModelHTTPError,
    ModelQuotaExceededError,
    ModelRateLimitError,
    ModelRequestTimeout,
    ModelServerError,
    ModelTimeoutError,
    ModelUnavailableError,
    RunTimedOut,
    UnexpectedModelBehavior,
    UsageLimitExceeded,
)

from services.extractor.tests.conftest import ModelScript
from services.extractor.tests.factories import long_table, text_pdf

CATEGORIES = {
    "model_auth",
    "rate_limited",
    "timeout",
    "input_too_large",
    "content_filtered",
    "invalid_model_output",
    "usage_limit",
    "upstream_error",
}

# A marker that must never reach the caller: model exception text can carry document
# content or a credential.
SECRET = "SECRET-doc-text-and-api-key"

ExcFactory = Callable[[str], BaseException]

# (name, factory taking free text, expected category)
FAILURES: list[tuple[str, ExcFactory, str]] = [
    ("auth", lambda t: ModelAuthenticationError("m", t, body=t), "model_auth"),
    ("rate", lambda t: ModelRateLimitError("m", t, body=t), "rate_limited"),
    ("quota", lambda t: ModelQuotaExceededError("m", t, body=t), "rate_limited"),
    ("timeout_err", lambda t: ModelTimeoutError("m", t), "timeout"),
    ("request_timeout", lambda t: ModelRequestTimeout("m", 5.0), "timeout"),
    ("run_timed_out", lambda t: RunTimedOut(t), "timeout"),
    ("context", lambda t: ModelContextWindowExceededError("m", t), "input_too_large"),
    ("content_filter", lambda t: ContentFilterError(t, body=t), "content_filtered"),
    ("unexpected", lambda t: UnexpectedModelBehavior(t, body=t), "invalid_model_output"),
    ("usage", lambda t: UsageLimitExceeded(t), "usage_limit"),
    ("api", lambda t: ModelAPIError("m", t, body=t), "upstream_error"),
    ("http", lambda t: ModelHTTPError(500, "m", body=t), "upstream_error"),
    ("connection", lambda t: ModelConnectionError("m", t), "upstream_error"),
    ("server", lambda t: ModelServerError("m", t, body=t), "upstream_error"),
    ("unavailable", lambda t: ModelUnavailableError("m", t), "upstream_error"),
]

PDF = text_pdf(["Kiln feed report", "Clinker produced 1,500 t"])
# One rule-mapped row and one row no rule can place, so a model call is needed.
LEFTOVER_XLSX = long_table(
    [
        ("Apr-2023", "coal_quantity", 100, "t"),
        ("Apr-2023", "Zzq widget throughput", 7, "t"),
    ]
)
DOC_TYPES = json.dumps([{"id": "invoice", "label": "Invoice"}])
CATALOGUE = json.dumps([{"path": "total", "kind": "number"}])
XLSX = ("a.xlsx", LEFTOVER_XLSX, "application/octet-stream")
PDF_FILE = ("a.pdf", PDF, "application/pdf")

# (endpoint, files, form data) for every endpoint that calls a model.
REQUESTS: dict[str, tuple[str, dict[str, Any], dict[str, str]]] = {
    "classify": ("/v1/classify", {"file": PDF_FILE}, {"allowed_doc_types": DOC_TYPES}),
    "classify-batch": (
        "/v1/classify-batch",
        {"files": PDF_FILE},
        {"allowed_doc_types": DOC_TYPES},
    ),
    "extract-fields": (
        "/v1/extract-fields",
        {"file": PDF_FILE},
        {"doc_type": "invoice", "catalogue": CATALOGUE},
    ),
    "extract-calendar-pdf": ("/v1/extract-calendar", {"file": PDF_FILE}, {}),
    "extract-calendar-xlsx": ("/v1/extract-calendar", {"file": XLSX}, {}),
}

# Free text placed in the exception. It always contains the secret marker.
texts = st.text(max_size=40).map(lambda s: f"{SECRET} {s}")


@settings(
    max_examples=60,
    deadline=None,
    suppress_health_check=[HealthCheck.function_scoped_fixture],
)
@given(
    failure=st.sampled_from(FAILURES),
    endpoint=st.sampled_from(sorted(REQUESTS)),
    text=texts,
)
def test_any_model_failure_is_502_without_readings(
    client: TestClient,
    model_script: ModelScript,
    auth_headers: dict[str, str],
    failure: tuple[str, ExcFactory, str],
    endpoint: str,
    text: str,
) -> None:
    _name, make, expected_category = failure
    path, files, data = REQUESTS[endpoint]

    def boom(_messages: Any, _info: Any) -> dict[str, Any]:
        raise make(text)

    model_script.handler = boom
    response = client.post(path, headers=auth_headers, files=files, data=data)

    assert response.status_code == 502, response.text
    body = response.json()
    assert body["ok"] is False
    assert body["error"]["code"] == "model_failure"
    assert body["error"]["category"] in CATEGORIES
    assert body["error"]["category"] == expected_category
    # No partial result of any kind.
    for key in ("readings", "fields", "items", "classification", "skipped", "unmapped"):
        assert key not in body
    # Neither the exception text nor the document text is echoed.
    assert SECRET not in response.text


def test_failure_table_covers_every_category() -> None:
    assert {c for _n, _f, c in FAILURES} == CATEGORIES


@pytest.mark.parametrize("endpoint", sorted(REQUESTS))
def test_model_was_actually_called_for_each_endpoint(
    client: TestClient,
    model_script: ModelScript,
    auth_headers: dict[str, str],
    endpoint: str,
) -> None:
    """Guards the property: each request reaches the model, so a 502 comes from it."""
    path, files, data = REQUESTS[endpoint]

    def boom(_messages: Any, _info: Any) -> dict[str, Any]:
        raise ModelAPIError("m", "down")

    model_script.handler = boom
    response = client.post(path, headers=auth_headers, files=files, data=data)
    assert response.status_code == 502, response.text
    assert len(model_script.calls) >= 1
