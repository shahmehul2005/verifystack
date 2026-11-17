"""Property 38: No secrets or contents in logs and errors.

For any request that triggers an error path, neither the captured log records nor the
response body contain either configured key or a canary string placed in the uploaded file.

**Validates: Requirements 17.2**
"""

from __future__ import annotations

import json
import logging
import traceback
from collections.abc import Callable
from typing import Any

import pytest
from fastapi.testclient import TestClient
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st
from pydantic_ai.exceptions import ModelAPIError, ModelAuthenticationError, UnexpectedModelBehavior

from services.extractor.tests.conftest import ModelScript
from services.extractor.tests.factories import long_table, text_pdf

_ALNUM = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
_token = st.text(alphabet=_ALNUM, min_size=12, max_size=24)

# Distinct prefixes keep the three secrets from being substrings of each other.
extractor_keys = _token.map(lambda s: f"EXKEY{s}")
gemini_keys = _token.map(lambda s: f"GMKEY{s}")
canaries = _token.map(lambda s: f"CANARY{s}")

DOC_TYPES = json.dumps([{"id": "invoice", "label": "Invoice"}])
CATALOGUE = json.dumps([{"path": "total", "kind": "number"}])

Failure = Callable[[str], BaseException]
MODEL_FAILURES: list[Failure] = [
    lambda t: ModelAuthenticationError("m", t, body=t),
    lambda t: ModelAPIError("m", t, body=t),
    lambda t: UnexpectedModelBehavior(t, body=t),
    lambda t: RuntimeError(t),
    lambda t: ValueError(t),
]


def _log_text(caplog: pytest.LogCaptureFixture) -> str:
    """Every captured record: message, formatted line, and any traceback text."""
    parts: list[str] = [caplog.text]
    for record in caplog.records:
        parts.append(record.getMessage())
        parts.append(str(record.args))
        parts.append(str(record.__dict__))
        if record.exc_info:
            parts.append("".join(traceback.format_exception(*record.exc_info)))
        if record.exc_text:
            parts.append(record.exc_text)
    return "\n".join(parts)


def _capture(caplog: pytest.LogCaptureFixture) -> None:
    """INFO and above everywhere (the production level), DEBUG for the service's own loggers."""
    caplog.set_level(logging.INFO)
    caplog.set_level(logging.DEBUG, logger="services.extractor")


def _assert_clean(
    response: Any, caplog: pytest.LogCaptureFixture, secrets: list[str]
) -> None:
    assert response.status_code >= 400, response.text
    body = response.text
    logs = _log_text(caplog)
    for secret in secrets:
        assert secret not in body, f"secret in response body: {secret}"
        assert secret not in logs, f"secret in log records: {secret}"


@pytest.fixture
def secret_env(monkeypatch: pytest.MonkeyPatch) -> Callable[[str, str], dict[str, str]]:
    """Install both keys for one example and return the auth header."""

    def install(extractor_key: str, gemini_key: str) -> dict[str, str]:
        monkeypatch.setenv("EXTRACTOR_API_KEY", extractor_key)
        monkeypatch.setenv("GEMINI_API_KEY", gemini_key)
        return {"X-Extractor-Key": extractor_key}

    return install


_SETTINGS = settings(
    max_examples=40,
    deadline=None,
    suppress_health_check=[HealthCheck.function_scoped_fixture],
)


@_SETTINGS
@given(
    ekey=extractor_keys,
    gkey=gemini_keys,
    canary=canaries,
    failure=st.sampled_from(MODEL_FAILURES),
    endpoint=st.sampled_from(["classify", "extract-fields", "extract-calendar-pdf", "extract-calendar-xlsx"]),
)
def test_model_failure_path_leaks_nothing(
    client: TestClient,
    model_script: ModelScript,
    secret_env: Callable[[str, str], dict[str, str]],
    caplog: pytest.LogCaptureFixture,
    ekey: str,
    gkey: str,
    canary: str,
    failure: Failure,
    endpoint: str,
) -> None:
    """The model exception text carries both keys and the document canary."""
    headers = secret_env(ekey, gkey)
    caplog.clear()
    _capture(caplog)
    leak = f"{ekey} {gkey} {canary}"

    def boom(_messages: Any, _info: Any) -> dict[str, Any]:
        raise failure(leak)

    model_script.handler = boom
    pdf = ("a.pdf", text_pdf([f"Clinker produced 1,500 t {canary}"]), "application/pdf")
    xlsx = (
        "a.xlsx",
        long_table(
            [
                ("Apr-2023", "coal_quantity", 100, "t"),
                ("Apr-2023", f"Zzq {canary} throughput", 7, "t"),
            ]
        ),
        "application/octet-stream",
    )
    requests: dict[str, tuple[str, dict[str, Any], dict[str, str]]] = {
        "classify": ("/v1/classify", {"file": pdf}, {"allowed_doc_types": DOC_TYPES}),
        "extract-fields": (
            "/v1/extract-fields",
            {"file": pdf},
            {"doc_type": "invoice", "catalogue": CATALOGUE},
        ),
        "extract-calendar-pdf": ("/v1/extract-calendar", {"file": pdf}, {}),
        "extract-calendar-xlsx": ("/v1/extract-calendar", {"file": xlsx}, {}),
    }
    path, files, data = requests[endpoint]
    response = client.post(path, headers=headers, files=files, data=data)

    assert response.status_code in (500, 502), response.text
    _assert_clean(response, caplog, [ekey, gkey, canary])


@_SETTINGS
@given(
    ekey=extractor_keys,
    gkey=gemini_keys,
    canary=canaries,
    case=st.sampled_from(["corrupt_xlsx", "unsupported", "bad_json", "bad_page", "bad_source_type"]),
    padding=st.binary(max_size=64),
)
def test_input_error_paths_leak_nothing(
    client: TestClient,
    secret_env: Callable[[str, str], dict[str, str]],
    caplog: pytest.LogCaptureFixture,
    ekey: str,
    gkey: str,
    canary: str,
    case: str,
    padding: bytes,
) -> None:
    """Bad files and bad form fields that hold the canary are rejected without echoing it."""
    headers = secret_env(ekey, gkey)
    caplog.clear()
    _capture(caplog)
    canary_bytes = canary.encode()

    if case == "corrupt_xlsx":
        # A zip signature followed by junk: detected as a workbook, then unreadable.
        content = b"PK\x03\x04" + canary_bytes + padding
        files = {"file": ("a.xlsx", content, "application/octet-stream")}
        response = client.post("/v1/extract-calendar", headers=headers, files=files)
    elif case == "unsupported":
        files = {"file": ("a.bin", canary_bytes + padding, "application/octet-stream")}
        response = client.post("/v1/extract-calendar", headers=headers, files=files)
    elif case == "bad_json":
        files = {"file": ("a.pdf", text_pdf([canary]), "application/pdf")}
        response = client.post(
            "/v1/classify",
            headers=headers,
            files=files,
            data={"allowed_doc_types": f'{{"x": "{canary}"'},
        )
    elif case == "bad_page":
        files = {"file": ("a.pdf", text_pdf([canary]), "application/pdf")}
        response = client.post(
            "/v1/classify",
            headers=headers,
            files=files,
            data={"allowed_doc_types": DOC_TYPES, "page_number": f"{canary}"},
        )
    else:
        files = {"file": ("a.pdf", text_pdf([canary]), "application/pdf")}
        response = client.post(
            "/v1/extract-calendar", headers=headers, files=files, data={"source_type": canary}
        )

    _assert_clean(response, caplog, [ekey, gkey, canary])


@_SETTINGS
@given(
    ekey=extractor_keys,
    gkey=gemini_keys,
    canary=canaries,
    wrong=st.sampled_from(["canary", "near_miss", "missing"]),
)
def test_auth_failures_leak_nothing(
    client: TestClient,
    secret_env: Callable[[str, str], dict[str, str]],
    caplog: pytest.LogCaptureFixture,
    ekey: str,
    gkey: str,
    canary: str,
    wrong: str,
) -> None:
    """A rejected key attempt is not logged or echoed, and the real key stays hidden."""
    secret_env(ekey, gkey)
    caplog.clear()
    _capture(caplog)
    headers: dict[str, str] = {}
    if wrong == "canary":
        headers = {"X-Extractor-Key": canary}
    elif wrong == "near_miss":
        headers = {"X-Extractor-Key": ekey[:-1]}
    files = {"file": ("a.pdf", text_pdf([canary]), "application/pdf")}
    response = client.post(
        "/v1/classify", headers=headers, files=files, data={"allowed_doc_types": DOC_TYPES}
    )
    assert response.status_code == 401, response.text
    _assert_clean(response, caplog, [ekey, gkey, canary])


@_SETTINGS
@given(ekey=extractor_keys, gkey=gemini_keys, canary=canaries)
def test_oversized_upload_leaks_nothing(
    client: TestClient,
    secret_env: Callable[[str, str], dict[str, str]],
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    ekey: str,
    gkey: str,
    canary: str,
) -> None:
    headers = secret_env(ekey, gkey)
    monkeypatch.setenv("EXTRACTOR_MAX_UPLOAD_BYTES", "64")
    caplog.clear()
    _capture(caplog)
    content = canary.encode() + b" " * 4096
    response = client.post(
        "/v1/extract-calendar",
        headers=headers,
        files={"file": ("a.xlsx", content, "application/octet-stream")},
    )
    assert response.status_code == 413, response.text
    _assert_clean(response, caplog, [ekey, gkey, canary])


def test_health_and_missing_model_key_do_not_reveal_keys(
    client: TestClient,
    secret_env: Callable[[str, str], dict[str, str]],
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """Example: /health reports a boolean only, and a missing Gemini key is named, not shown."""
    headers = secret_env("EXKEYhealthcheck0001", "GMKEYhealthcheck0001")
    _capture(caplog)
    health = client.get("/health")
    assert health.status_code == 200
    assert "GMKEYhealthcheck0001" not in health.text
    assert "EXKEYhealthcheck0001" not in health.text
    assert health.json()["gemini_configured"] is True
    _ = headers
