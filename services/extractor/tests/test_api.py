"""Unit tests for the HTTP API (Requirements 1.2-1.4, 2.1-2.4, 3.3, 3.5, 8.3, 8.4).

The tests drive the real FastAPI app through ``TestClient``. A model, when a request needs
one, is the ``FunctionModel`` injected by the ``client`` fixture, so no test touches the
network. The ``client`` fixture installs no credential: use ``auth_headers`` to set one.
"""

from __future__ import annotations

import io
import json
from typing import Any

import openpyxl
import pytest
from fastapi.testclient import TestClient
from pydantic_ai.exceptions import ModelHTTPError, ModelRateLimitError
from pydantic_ai.messages import ModelMessage
from pydantic_ai.models.function import AgentInfo

from services.extractor import __version__
from services.extractor.agents import ModelNotConfigured
from services.extractor.api import (
    ExtractorError,
    app,
    get_model_provider,
    translate_error,
)
from services.extractor.config import get_settings
from services.extractor.pdf_text import PageCapExceeded
from services.extractor.pipeline import LayoutNotRecognized, ModelFailure, PageOutOfRange
from services.extractor.workbook import CorruptFile, PasswordProtected, UnsupportedFormat

from .conftest import TEST_API_KEY, ModelScript
from .factories import long_table, multi_page_pdf, text_pdf

XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
PDF_TYPE = "application/pdf"

# One row a rule maps and one row no rule can place, so the Mapper_Agent is needed.
NEEDS_MODEL = long_table(
    [
        ("Apr-2023", "coal_quantity", 100, "t"),
        ("Apr-2023", "Zzq widget throughput", 5, "t"),
    ]
)
# Every label is placed by a rule, so no model and no GEMINI_API_KEY is needed.
RULES_ONLY = long_table([("Apr-2023", "coal_quantity", 100, "t")])

DOC_TYPES = json.dumps([{"id": "invoice", "label": "Invoice"}])
CATALOGUE = json.dumps([{"path": "total", "kind": "number"}])

# (method, path, multipart form data that the endpoint would accept after the key check)
V1_ENDPOINTS = [
    ("GET", "/v1/template"),
    ("POST", "/v1/classify"),
    ("POST", "/v1/classify-batch"),
    ("POST", "/v1/extract-fields"),
    ("POST", "/v1/extract-calendar"),
]


def call(client: TestClient, method: str, path: str, headers: dict[str, str] | None = None) -> Any:
    """A request with no body, which is all the key check needs."""
    return client.request(method, path, headers=headers)


def error_of(response: Any) -> dict[str, Any]:
    """The error envelope of a non-2xx response, checked for shape."""
    body = response.json()
    assert body["ok"] is False
    assert set(body) == {"ok", "error"}
    error = body["error"]
    assert isinstance(error["code"], str) and isinstance(error["message"], str)
    return error


def post_calendar(
    client: TestClient,
    headers: dict[str, str],
    data: bytes,
    *,
    name: str = "upload.xlsx",
    media_type: str = XLSX_TYPE,
    **form: str,
) -> Any:
    return client.post(
        "/v1/extract-calendar",
        headers=headers,
        files={"file": (name, data, media_type)},
        data={"compliance_year": "FY2023-24", **form},
    )


def raising(exc: BaseException) -> Any:
    def handler(_messages: list[ModelMessage], _info: AgentInfo) -> dict[str, Any]:
        raise exc

    return handler


# ---------------------------------------------------------------------------
# GET /health (1.3)
# ---------------------------------------------------------------------------


def test_health_is_open_and_reports_no_gemini_key(client: TestClient) -> None:
    response = client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["service"] == "verifystack-extractor"
    assert body["version"] == __version__
    assert body["gemini_configured"] is False
    assert body["model"] == get_settings().model


def test_health_reports_a_configured_key_as_a_boolean_and_never_the_secret(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, auth_headers: dict[str, str]
) -> None:
    monkeypatch.setenv("GEMINI_API_KEY", "gemini-secret-value")
    response = client.get("/health")  # no X-Extractor-Key header
    assert response.status_code == 200
    assert response.json()["gemini_configured"] is True
    assert "gemini-secret-value" not in response.text
    assert TEST_API_KEY not in response.text


def test_health_reports_the_configured_model_name(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("EXTRACTOR_MODEL", "gemini-custom")
    assert client.get("/health").json()["model"] == "gemini-custom"


# ---------------------------------------------------------------------------
# Endpoint availability (1.2)
# ---------------------------------------------------------------------------


def test_app_exposes_the_documented_endpoints() -> None:
    routes = {
        (method, route.path)  # type: ignore[attr-defined]
        for route in app.routes
        for method in getattr(route, "methods", None) or ()
    }
    assert ("GET", "/health") in routes
    assert ("GET", "/v1/template") in routes
    for path in ("classify", "classify-batch", "extract-fields", "extract-calendar"):
        assert ("POST", f"/v1/{path}") in routes


def test_unknown_path_returns_404_in_the_error_envelope(client: TestClient) -> None:
    response = client.get("/v1/nothing-here")
    assert response.status_code == 404
    assert error_of(response)["code"] == "not_found"


def test_wrong_method_returns_405_in_the_error_envelope(client: TestClient) -> None:
    response = client.get("/v1/classify")
    assert response.status_code == 405
    assert error_of(response)["code"] == "method_not_allowed"


# ---------------------------------------------------------------------------
# 401 and 503 for the key (2.1, 2.2)
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(("method", "path"), V1_ENDPOINTS)
def test_missing_key_header_returns_401(
    client: TestClient, auth_headers: dict[str, str], method: str, path: str
) -> None:
    response = call(client, method, path)
    assert response.status_code == 401
    assert error_of(response)["code"] == "unauthorized"


@pytest.mark.parametrize(("method", "path"), V1_ENDPOINTS)
def test_wrong_key_returns_401_and_does_not_echo_either_key(
    client: TestClient, auth_headers: dict[str, str], method: str, path: str
) -> None:
    response = call(client, method, path, {"X-Extractor-Key": "not-the-key"})
    assert response.status_code == 401
    assert "not-the-key" not in response.text
    assert TEST_API_KEY not in response.text


def test_key_of_a_different_length_returns_401(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    response = call(client, "GET", "/v1/template", {"X-Extractor-Key": TEST_API_KEY + "x"})
    assert response.status_code == 401
    assert call(client, "GET", "/v1/template", {"X-Extractor-Key": ""}).status_code == 401


@pytest.mark.parametrize(("method", "path"), V1_ENDPOINTS)
def test_empty_server_key_returns_503_naming_the_setting(
    client: TestClient, method: str, path: str
) -> None:
    response = call(client, method, path)
    assert response.status_code == 503
    error = error_of(response)
    assert error["code"] == "extractor_key_missing"
    assert "EXTRACTOR_API_KEY" in error["message"]


def test_empty_server_key_refuses_even_a_request_that_sends_a_key(client: TestClient) -> None:
    response = call(client, "GET", "/v1/template", {"X-Extractor-Key": "anything"})
    assert response.status_code == 503


def test_key_check_runs_before_the_body_is_read(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    """A bad key with a body that is not multipart still gets 401, not 400."""
    response = client.post(
        "/v1/extract-calendar",
        headers={"X-Extractor-Key": "wrong"},
        content=b"not multipart",
    )
    assert response.status_code == 401


def test_valid_key_lets_a_request_through(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    assert client.get("/v1/template", headers=auth_headers).status_code == 200


# ---------------------------------------------------------------------------
# 503 for the model key (3.3)
# ---------------------------------------------------------------------------


@pytest.fixture
def real_provider(client: TestClient) -> TestClient:
    """The client with the injected model removed, so the real Gemini provider answers."""
    app.dependency_overrides.pop(get_model_provider, None)
    return client


def test_calendar_that_needs_a_model_without_gemini_key_returns_503(
    real_provider: TestClient, auth_headers: dict[str, str]
) -> None:
    response = post_calendar(real_provider, auth_headers, NEEDS_MODEL)
    assert response.status_code == 503
    error = error_of(response)
    assert error["code"] == "gemini_key_missing"
    assert "GEMINI_API_KEY" in error["message"]


def test_calendar_that_needs_no_model_works_without_gemini_key(
    real_provider: TestClient, auth_headers: dict[str, str]
) -> None:
    response = post_calendar(real_provider, auth_headers, RULES_ONLY)
    assert response.status_code == 200
    assert response.json()["run"]["model_calls"] == 0


def test_classify_without_gemini_key_returns_503(
    real_provider: TestClient, auth_headers: dict[str, str]
) -> None:
    response = real_provider.post(
        "/v1/classify",
        headers=auth_headers,
        files={"file": ("doc.pdf", text_pdf(["Invoice 123"]), PDF_TYPE)},
        data={"allowed_doc_types": DOC_TYPES},
    )
    assert response.status_code == 503
    assert "GEMINI_API_KEY" in error_of(response)["message"]


def test_extract_fields_without_gemini_key_returns_503(
    real_provider: TestClient, auth_headers: dict[str, str]
) -> None:
    response = real_provider.post(
        "/v1/extract-fields",
        headers=auth_headers,
        files={"file": ("doc.pdf", text_pdf(["Total 10"]), PDF_TYPE)},
        data={"doc_type": "invoice", "catalogue": CATALOGUE},
    )
    assert response.status_code == 503
    assert "GEMINI_API_KEY" in error_of(response)["message"]


def test_pdf_calendar_without_gemini_key_returns_503(
    real_provider: TestClient, auth_headers: dict[str, str]
) -> None:
    response = post_calendar(
        real_provider, auth_headers, text_pdf(["Coal 100 t"]), name="a.pdf", media_type=PDF_TYPE
    )
    assert response.status_code == 503
    assert "GEMINI_API_KEY" in error_of(response)["message"]


# ---------------------------------------------------------------------------
# 413 size and page caps (2.3, 2.4)
# ---------------------------------------------------------------------------


def test_file_over_the_size_cap_returns_413(
    client: TestClient, auth_headers: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("EXTRACTOR_MAX_UPLOAD_BYTES", "1000")
    response = post_calendar(client, auth_headers, b"x" * 2000)
    assert response.status_code == 413
    assert error_of(response)["code"] == "file_too_large"


def test_file_exactly_at_the_size_cap_is_not_rejected_for_size(
    client: TestClient, auth_headers: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("EXTRACTOR_MAX_UPLOAD_BYTES", str(len(RULES_ONLY)))
    assert post_calendar(client, auth_headers, RULES_ONLY).status_code == 200
    monkeypatch.setenv("EXTRACTOR_MAX_UPLOAD_BYTES", str(len(RULES_ONLY) - 1))
    assert post_calendar(client, auth_headers, RULES_ONLY).status_code == 413


def test_size_cap_default_is_25_megabytes() -> None:
    assert get_settings().max_upload_bytes == 25 * 1024 * 1024


@pytest.mark.parametrize(
    ("path", "files", "data"),
    [
        ("/v1/classify", "file", {"allowed_doc_types": DOC_TYPES}),
        ("/v1/extract-fields", "file", {"doc_type": "invoice", "catalogue": CATALOGUE}),
    ],
)
def test_single_page_endpoints_return_413_for_a_file_over_the_cap(
    client: TestClient,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
    path: str,
    files: str,
    data: dict[str, str],
) -> None:
    monkeypatch.setenv("EXTRACTOR_MAX_UPLOAD_BYTES", "1000")
    response = client.post(
        path, headers=auth_headers, files={files: ("doc.pdf", b"%PDF-" + b"x" * 3000, PDF_TYPE)}, data=data
    )
    assert response.status_code == 413
    assert error_of(response)["code"] == "file_too_large"


def test_request_body_far_over_the_cap_is_stopped_by_content_length(
    client: TestClient, auth_headers: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("EXTRACTOR_MAX_UPLOAD_BYTES", "1000")
    big = b"x" * (2 * 1024 * 1024)  # past the cap plus the 1 MB form allowance
    response = post_calendar(client, auth_headers, big)
    assert response.status_code == 413


def test_pdf_over_the_page_cap_returns_413(
    client: TestClient, auth_headers: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("EXTRACTOR_MAX_PDF_PAGES", "2")
    response = post_calendar(
        client, auth_headers, multi_page_pdf(3), name="big.pdf", media_type=PDF_TYPE
    )
    assert response.status_code == 413
    assert error_of(response)["code"] == "page_cap_exceeded"


def test_page_cap_default_is_100_pages() -> None:
    assert get_settings().max_pdf_pages == 100


def test_classify_returns_413_for_a_pdf_over_the_page_cap(
    client: TestClient, auth_headers: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("EXTRACTOR_MAX_PDF_PAGES", "2")
    response = client.post(
        "/v1/classify",
        headers=auth_headers,
        files={"file": ("doc.pdf", multi_page_pdf(3), PDF_TYPE)},
        data={"allowed_doc_types": DOC_TYPES},
    )
    assert response.status_code == 413
    assert error_of(response)["code"] == "page_cap_exceeded"


# ---------------------------------------------------------------------------
# 415 and 422 (8.3, 8.4)
# ---------------------------------------------------------------------------


def test_unrecognized_content_returns_415_with_the_supported_formats(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    response = post_calendar(client, auth_headers, b"\x00\x01\x02 not a document \xff", name="x.xlsx")
    assert response.status_code == 415
    error = error_of(response)
    assert error["code"] == "unsupported_format"
    assert {"xlsx", "xls", "csv", "pdf"} <= set(error["supported"])


def test_corrupt_xlsx_returns_422_with_the_cause(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    response = post_calendar(client, auth_headers, b"PK\x03\x04" + b"garbage" * 40)
    assert response.status_code == 422
    assert error_of(response)["code"] == "corrupt_file"


def test_corrupt_pdf_returns_422(client: TestClient, auth_headers: dict[str, str]) -> None:
    response = post_calendar(
        client, auth_headers, b"%PDF-1.4\n" + b"garbage" * 40, name="x.pdf", media_type=PDF_TYPE
    )
    assert response.status_code == 422
    assert error_of(response)["code"] in {"corrupt_file", "password_protected"}


def test_workbook_with_no_table_or_pro_forma_returns_422(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    wb = openpyxl.Workbook()
    ws = wb.active
    assert ws is not None
    ws["A1"] = "Just a note"
    buf = io.BytesIO()
    wb.save(buf)
    response = post_calendar(client, auth_headers, buf.getvalue())
    assert response.status_code == 422
    assert error_of(response)["code"] == "layout_not_recognized"


def test_wrong_extension_is_processed_by_detected_format_with_a_warning(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    response = post_calendar(client, auth_headers, RULES_ONLY, name="data.csv")
    assert response.status_code == 200
    body = response.json()
    assert body["file"]["format"] == "xlsx"
    assert "extension_mismatch" in [w["code"] for w in body["warnings"]]


# Exceptions the pipeline can raise, with the status and code the table assigns.
@pytest.mark.parametrize(
    ("exc", "status", "code"),
    [
        (UnsupportedFormat("x"), 415, "unsupported_format"),
        (PasswordProtected("x"), 422, "password_protected"),
        (CorruptFile("x"), 422, "corrupt_file"),
        (LayoutNotRecognized("x"), 422, "layout_not_recognized"),
        (PageCapExceeded(3, 2), 413, "page_cap_exceeded"),
        (PageOutOfRange(9, 1), 400, "bad_request"),
        (ModelNotConfigured("GEMINI_API_KEY"), 503, "gemini_key_missing"),
        (ModelFailure("timeout", "TimeoutError"), 502, "model_failure"),
        (RuntimeError("boom"), 500, "internal_error"),
    ],
)
def test_translate_error_follows_the_status_table(exc: BaseException, status: int, code: str) -> None:
    err = translate_error(exc)
    assert (err.status, err.code) == (status, code)


def test_translate_error_never_uses_the_exception_text() -> None:
    err = translate_error(RuntimeError("secret-document-text"))
    assert "secret-document-text" not in err.message


def test_translate_error_passes_an_extractor_error_through() -> None:
    original = ExtractorError(418, "teapot", "short and stout")
    assert translate_error(original) is original


# ---------------------------------------------------------------------------
# 400 for malformed requests
# ---------------------------------------------------------------------------


def test_non_multipart_request_returns_400(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    response = client.post("/v1/extract-calendar", headers=auth_headers, json={"a": 1})
    assert response.status_code == 400
    assert error_of(response)["code"] == "bad_request"


def test_missing_file_field_returns_400(client: TestClient, auth_headers: dict[str, str]) -> None:
    response = client.post(
        "/v1/extract-calendar", headers=auth_headers, files={"other": ("a.txt", b"x", "text/plain")}
    )
    assert response.status_code == 400
    assert "file" in error_of(response)["message"]


def test_invalid_source_type_returns_400(client: TestClient, auth_headers: dict[str, str]) -> None:
    response = post_calendar(client, auth_headers, RULES_ONLY, source_type="made_up")
    assert response.status_code == 400
    assert error_of(response)["code"] == "bad_request"


def test_invalid_layout_returns_400(client: TestClient, auth_headers: dict[str, str]) -> None:
    assert post_calendar(client, auth_headers, RULES_ONLY, layout="diagonal").status_code == 400


def test_classify_with_malformed_doc_types_returns_400_without_echoing_them(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    response = client.post(
        "/v1/classify",
        headers=auth_headers,
        files={"file": ("doc.pdf", text_pdf(["x"]), PDF_TYPE)},
        data={"allowed_doc_types": "{not json secret-token"},
    )
    assert response.status_code == 400
    assert "secret-token" not in response.text


@pytest.mark.parametrize("page", ["0", "-1", "abc"])
def test_classify_with_a_bad_page_number_returns_400(
    client: TestClient, auth_headers: dict[str, str], page: str
) -> None:
    response = client.post(
        "/v1/classify",
        headers=auth_headers,
        files={"file": ("doc.pdf", text_pdf(["x"]), PDF_TYPE)},
        data={"allowed_doc_types": DOC_TYPES, "page_number": page},
    )
    assert response.status_code == 400


def test_classify_with_a_page_beyond_the_last_page_returns_400(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    response = client.post(
        "/v1/classify",
        headers=auth_headers,
        files={"file": ("doc.pdf", text_pdf(["x"]), PDF_TYPE)},
        data={"allowed_doc_types": DOC_TYPES, "page_number": "9"},
    )
    assert response.status_code == 400


def test_extract_fields_without_doc_type_returns_400(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    response = client.post(
        "/v1/extract-fields",
        headers=auth_headers,
        files={"file": ("doc.pdf", text_pdf(["x"]), PDF_TYPE)},
        data={"catalogue": CATALOGUE},
    )
    assert response.status_code == 400


def test_classify_batch_without_files_returns_400(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    response = client.post(
        "/v1/classify-batch", headers=auth_headers, data={"allowed_doc_types": DOC_TYPES}
    )
    assert response.status_code == 400


def test_classify_batch_over_the_batch_limit_returns_400(
    client: TestClient, auth_headers: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("EXTRACTOR_MAX_BATCH", "1")
    pdf = text_pdf(["x"])
    response = client.post(
        "/v1/classify-batch",
        headers=auth_headers,
        files=[("files", ("a.pdf", pdf, PDF_TYPE)), ("files", ("b.pdf", pdf, PDF_TYPE))],
        data={"allowed_doc_types": DOC_TYPES},
    )
    assert response.status_code == 400


# ---------------------------------------------------------------------------
# GET /v1/template (1.4)
# ---------------------------------------------------------------------------


def test_template_downloads_an_xlsx_workbook(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    response = client.get("/v1/template", headers=auth_headers, params={"year": "FY2025-26"})
    assert response.status_code == 200
    assert response.headers["content-type"] == XLSX_TYPE
    disposition = response.headers["content-disposition"]
    assert disposition.startswith("attachment;")
    assert "verifystack_calendar_template_FY2025-26.xlsx" in disposition
    wb = openpyxl.load_workbook(io.BytesIO(response.content))
    assert wb.sheetnames[:3] == ["Calendar", "Streams", "Instructions"]
    header = [c.value for c in wb["Calendar"][1]]
    assert header[:4] == ["Month", "Stream", "Value", "Unit"]


def test_template_without_a_year_still_downloads(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    response = client.get("/v1/template", headers=auth_headers)
    assert response.status_code == 200
    assert "verifystack_calendar_template_current.xlsx" in response.headers["content-disposition"]


def test_template_with_an_invalid_year_returns_400(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    response = client.get("/v1/template", headers=auth_headers, params={"year": "not a year"})
    assert response.status_code == 400
    assert error_of(response)["code"] == "bad_request"


def test_template_filename_holds_only_safe_characters(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    """A hostile ``year`` value never reaches the Content-Disposition header."""
    response = client.get(
        "/v1/template", headers=auth_headers, params={"year": 'FY2025-26"; x=1\r\nX-Evil: 1'}
    )
    assert "x-evil" not in {k.lower() for k in response.headers}
    assert '; x=1' not in response.headers.get("content-disposition", "")


def test_template_is_readable_by_the_extractor(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    """The template, once a Value is filled in, is read back as readings (1.4)."""
    template = client.get("/v1/template", headers=auth_headers, params={"year": "FY2023-24"})
    wb = openpyxl.load_workbook(io.BytesIO(template.content))
    ws = wb["Calendar"]
    ws.cell(row=2, column=3, value=123)
    buf = io.BytesIO()
    wb.save(buf)
    response = post_calendar(client, auth_headers, buf.getvalue())
    assert response.status_code == 200, response.text
    readings = response.json()["readings"]
    assert len(readings) == 1  # empty Value cells are not readings
    assert readings[0]["stream_key"] == ws.cell(row=2, column=2).value
    assert readings[0]["period"]["month_key"] == "2023-04"


# ---------------------------------------------------------------------------
# 502 model failure (3.5)
# ---------------------------------------------------------------------------


def test_model_failure_returns_502_with_category_and_no_readings(
    client: TestClient, auth_headers: dict[str, str], model_script: ModelScript
) -> None:
    model_script.handler = raising(ModelHTTPError(500, "test-model", "upstream down"))
    response = post_calendar(client, auth_headers, NEEDS_MODEL)
    assert response.status_code == 502
    body = response.json()
    assert body["ok"] is False
    assert body["error"]["code"] == "model_failure"
    assert body["error"]["category"] == "upstream_error"
    # No partial readings, not even the rule-mapped row.
    assert "readings" not in body
    assert "coal_quantity" not in response.text


def test_model_failure_category_follows_the_exception_and_hides_its_text(
    client: TestClient, auth_headers: dict[str, str], model_script: ModelScript
) -> None:
    model_script.handler = raising(
        ModelHTTPError.for_category(
            ModelRateLimitError,
            status_code=429,
            model_name="test-model",
            body="secret-document-text",
        )
    )
    response = post_calendar(client, auth_headers, NEEDS_MODEL)
    assert response.status_code == 502
    assert response.json()["error"]["category"] == "rate_limited"
    assert "secret-document-text" not in response.text


def test_classify_model_failure_returns_502(
    client: TestClient, auth_headers: dict[str, str], model_script: ModelScript
) -> None:
    model_script.handler = raising(ModelHTTPError(503, "test-model", "down"))
    response = client.post(
        "/v1/classify",
        headers=auth_headers,
        files={"file": ("doc.pdf", text_pdf(["Invoice"]), PDF_TYPE)},
        data={"allowed_doc_types": DOC_TYPES},
    )
    assert response.status_code == 502
    assert error_of(response)["category"] == "upstream_error"


def test_extract_fields_model_failure_returns_502(
    client: TestClient, auth_headers: dict[str, str], model_script: ModelScript
) -> None:
    model_script.handler = raising(ModelHTTPError(503, "test-model", "down"))
    response = client.post(
        "/v1/extract-fields",
        headers=auth_headers,
        files={"file": ("doc.pdf", text_pdf(["Total 10"]), PDF_TYPE)},
        data={"doc_type": "invoice", "catalogue": CATALOGUE},
    )
    assert response.status_code == 502
    assert error_of(response)["category"] == "upstream_error"


def test_unexpected_exception_returns_500_without_its_text(
    client: TestClient, auth_headers: dict[str, str], model_script: ModelScript
) -> None:
    model_script.handler = raising(RuntimeError("secret-document-text"))
    response = post_calendar(client, auth_headers, NEEDS_MODEL)
    assert response.status_code == 500
    assert error_of(response)["code"] == "internal_error"
    assert "secret-document-text" not in response.text


# ---------------------------------------------------------------------------
# Success path through the model
# ---------------------------------------------------------------------------


def test_successful_calendar_response_has_the_documented_shape(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    response = post_calendar(client, auth_headers, RULES_ONLY)
    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert {"file", "readings", "skipped", "unmapped", "warnings", "run"} <= set(body)
    assert [r["stream_key"] for r in body["readings"]] == ["coal_quantity"]


def test_calendar_that_needs_a_model_uses_the_injected_one(
    client: TestClient, auth_headers: dict[str, str], model_script: ModelScript
) -> None:
    response = post_calendar(client, auth_headers, NEEDS_MODEL)
    assert response.status_code == 200
    assert len(model_script.calls) == 1
    assert response.json()["unmapped"] == ["Zzq widget throughput"]
