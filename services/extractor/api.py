"""FastAPI app for the Extractor_Service.

Endpoints:

* ``GET /health``: open, reports a boolean for the Gemini key and nothing secret.
* ``GET /v1/template``: the calendar template workbook.
* ``POST /v1/classify``, ``/v1/classify-batch``, ``/v1/extract-fields``,
  ``/v1/extract-calendar``: ``multipart/form-data``.

Every ``/v1/*`` route checks the ``X-Extractor-Key`` header first (503 when
``EXTRACTOR_API_KEY`` is empty, then 401, compared in constant time). The routes read the
multipart body themselves instead of declaring ``Form`` and ``File`` parameters, so no
upload byte is read before the key passes and the size cap can stop a request while it is
still arriving (413).

Every non-2xx response carries the error envelope
``{"ok": false, "error": {"code", "message", "category", "supported"}}``. Messages are
fixed strings. They never hold file contents, header values, prompts or model exception
text.

Logging records the request id, endpoint, file hash, size, format, counts and durations.
For a failed model call it records the exception class name only.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import re
import time
import uuid
from collections.abc import Awaitable, Callable
from typing import Any, TypeVar

from fastapi import Depends, FastAPI, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import TypeAdapter, ValidationError
from starlette.concurrency import run_in_threadpool
from starlette.datastructures import FormData, UploadFile
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.formparsers import MultiPartException
from starlette.types import Message

from . import __version__
from .agents import GeminiModelProvider, ModelNotConfigured, ModelProvider, classify_failure
from .config import Settings, get_settings
from .models import (
    CalendarParams,
    CatalogueEntry,
    DocTypeOption,
    ErrorDetail,
    ErrorResponse,
    ExtractFieldsParams,
    HealthResponse,
)
from .pdf_text import PageCapExceeded
from .pipeline import (
    LayoutNotRecognized,
    ModelFailure,
    PageOutOfRange,
    PipelineDeps,
    Upload,
    classify,
    classify_batch,
    extract_calendar,
    extract_fields,
)
from .workbook import (
    SUPPORTED_FORMATS,
    CorruptFile,
    PasswordProtected,
    UnsupportedFormat,
    build_calendar_template,
)

__all__ = [
    "ExtractorError",
    "app",
    "create_app",
    "get_model_provider",
    "read_capped",
    "require_key",
    "translate_error",
]

SERVICE_NAME = "verifystack-extractor"
XLSX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

# Room in a request for the form fields and multipart framing around the files.
_FORM_OVERHEAD_BYTES = 1024 * 1024

logger = logging.getLogger("services.extractor.api")

T = TypeVar("T")


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------


class ExtractorError(Exception):
    """An error that becomes an HTTP response with the error envelope."""

    def __init__(
        self,
        status: int,
        code: str,
        message: str,
        *,
        category: str | None = None,
        supported: list[str] | None = None,
    ) -> None:
        super().__init__(code)
        self.status = status
        self.code = code
        self.message = message
        self.category = category
        self.supported = supported


def _megabytes(n: int) -> str:
    if n < 1024 * 1024:
        return f"{n} bytes"
    return f"{n / (1024 * 1024):g} MB"


def translate_error(exc: BaseException, settings: Settings | None = None) -> ExtractorError:
    """Map any exception the pipeline can raise to the HTTP error of the status table.

    A model-layer exception that escaped the pipeline is mapped to 502 too, so that no
    model failure can reach the caller as anything else (Requirement 3.5). The message of
    the original exception is never used.
    """
    if isinstance(exc, ExtractorError):
        return exc
    if isinstance(exc, ModelNotConfigured):
        return ExtractorError(
            503, "gemini_key_missing", "GEMINI_API_KEY is not set, and this request needs a model"
        )
    if isinstance(exc, ModelFailure):
        return ExtractorError(
            502, "model_failure", "A model call failed", category=exc.category
        )
    if isinstance(exc, UnsupportedFormat):
        return ExtractorError(
            415,
            "unsupported_format",
            "The file content matches none of the supported formats",
            supported=list(getattr(exc, "supported", SUPPORTED_FORMATS)),
        )
    if isinstance(exc, PasswordProtected):
        return ExtractorError(422, "password_protected", "The file is password-protected")
    if isinstance(exc, CorruptFile):
        return ExtractorError(422, "corrupt_file", "The file is corrupt or cannot be read")
    if isinstance(exc, LayoutNotRecognized):
        return ExtractorError(
            422,
            "layout_not_recognized",
            "No table or pro forma sheet was found in the workbook",
        )
    if isinstance(exc, PageCapExceeded):
        cap = f" of {settings.max_pdf_pages} pages" if settings is not None else ""
        return ExtractorError(413, "page_cap_exceeded", f"The PDF exceeds the page cap{cap}")
    if isinstance(exc, PageOutOfRange):
        return ExtractorError(400, "bad_request", "page_number is beyond the last page of the file")
    category = classify_failure(exc)
    if category is not None:
        return ExtractorError(502, "model_failure", "A model call failed", category=category)
    return ExtractorError(500, "internal_error", "The service failed to process the request")


def _error_response(err: ExtractorError) -> JSONResponse:
    body = ErrorResponse(
        error=ErrorDetail(
            code=err.code,
            message=err.message,
            category=err.category,
            supported=err.supported,
        )
    )
    # exclude_none keeps `category` and `supported` out of errors that do not use them.
    return JSONResponse(status_code=err.status, content=body.model_dump(exclude_none=True))


# ---------------------------------------------------------------------------
# Dependencies
# ---------------------------------------------------------------------------


def require_key(
    request: Request, settings: Settings = Depends(get_settings)
) -> None:
    """Check ``X-Extractor-Key``. Runs before any body is read.

    503 when ``EXTRACTOR_API_KEY`` is empty, then 401 for a missing or wrong key. The
    comparison takes the same time for every wrong key of the same length.
    """
    if not settings.extractor_api_key:
        raise ExtractorError(503, "extractor_key_missing", "EXTRACTOR_API_KEY is not set")
    supplied = (request.headers.get("x-extractor-key") or "").encode()
    if not hmac.compare_digest(supplied, settings.extractor_api_key.encode()):
        raise ExtractorError(401, "unauthorized", "Missing or invalid X-Extractor-Key")


def get_model_provider(settings: Settings = Depends(get_settings)) -> ModelProvider:
    """The model provider. Tests replace it with ``app.dependency_overrides``."""
    return GeminiModelProvider(settings)


# ---------------------------------------------------------------------------
# Reading the request
# ---------------------------------------------------------------------------


async def read_capped(upload: UploadFile, cap: int) -> bytes:
    """Read an uploaded file, at most ``cap`` bytes. More than ``cap`` raises 413."""
    too_large = ExtractorError(413, "file_too_large", f"File exceeds {_megabytes(cap)}")
    if upload.size is not None and upload.size > cap:
        raise too_large
    data = await upload.read(cap + 1)
    if len(data) > cap:
        raise too_large
    return data


async def _read_form(request: Request, *, limit: int, max_files: int) -> FormData:
    """Parse the multipart body, stopping as soon as it exceeds ``limit`` bytes.

    The ``Content-Length`` header is checked first. A body sent without it is counted
    as it arrives, so an oversized upload is cut off instead of being stored first.
    """
    content_type = request.headers.get("content-type", "").split(";")[0].strip().lower()
    if content_type != "multipart/form-data":
        raise ExtractorError(400, "bad_request", "The request must be multipart/form-data")
    too_large = ExtractorError(413, "file_too_large", "The request body is larger than the upload cap")
    declared = request.headers.get("content-length")
    if declared is not None and declared.isdigit() and int(declared) > limit:
        raise too_large

    received = 0
    original_receive = request.receive

    async def counting_receive() -> Message:
        nonlocal received
        message = await original_receive()
        if message["type"] == "http.request":
            received += len(message.get("body", b""))
            if received > limit:
                raise too_large
        return message

    counted = Request(request.scope, receive=counting_receive)
    try:
        return await counted.form(max_files=max_files, max_fields=max_files + 16)
    except (StarletteHTTPException, MultiPartException):
        raise ExtractorError(400, "bad_request", "The multipart body could not be read") from None


def _upload_of(form: FormData, name: str) -> UploadFile:
    value = form.get(name)
    if not isinstance(value, UploadFile):
        raise ExtractorError(400, "bad_request", f"The file field {name!r} is required")
    return value


def _text_of(form: FormData, name: str, *, required: bool = False) -> str | None:
    value = form.get(name)
    if value is None:
        if required:
            raise ExtractorError(400, "bad_request", f"The field {name!r} is required")
        return None
    if not isinstance(value, str):
        raise ExtractorError(400, "bad_request", f"The field {name!r} must be text")
    return value


def _json_of(form: FormData, name: str, adapter: TypeAdapter[T]) -> T:
    """A required form field that holds JSON, validated. Errors never echo the input."""
    raw = _text_of(form, name, required=True)
    try:
        return adapter.validate_python(json.loads(raw or ""))
    except (ValueError, ValidationError):
        raise ExtractorError(400, "bad_request", f"The field {name!r} is not valid JSON of the expected shape") from None


def _page_number_of(form: FormData) -> int:
    raw = _text_of(form, "page_number")
    if raw is None or not raw.strip():
        return 1
    try:
        page = int(raw.strip())
    except ValueError:
        page = 0
    if page < 1:
        raise ExtractorError(400, "bad_request", "page_number must be a whole number of at least 1")
    return page


_DOC_TYPES = TypeAdapter(list[DocTypeOption])
_CATALOGUE = TypeAdapter(list[CatalogueEntry])


def _sniff_format(data: bytes) -> str:
    """A coarse format name for logs: the single-page endpoints also take images."""
    if b"%PDF-" in data[:1024]:
        return "pdf"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if data.startswith(b"\xff\xd8\xff"):
        return "jpeg"
    return "other"


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _log(endpoint: str, request_id: str, started: float, **fields: Any) -> None:
    """One structured line. Callers pass counts, hashes and sizes only."""
    parts = " ".join(f"{k}={v}" for k, v in fields.items() if v is not None)
    logger.info(
        "request_id=%s endpoint=%s duration_ms=%d %s",
        request_id,
        endpoint,
        int((time.perf_counter() - started) * 1000),
        parts,
    )


def _log_failure(endpoint: str, request_id: str, started: float, exc: BaseException, err: ExtractorError) -> None:
    # The class name only. The text of an exception can hold document content or a credential.
    cause = getattr(exc, "cause", "") or type(exc).__name__
    level = logging.ERROR if err.status >= 500 and err.status != 502 else logging.WARNING
    logger.log(
        level,
        "request_id=%s endpoint=%s duration_ms=%d status=%d code=%s cause=%s",
        request_id,
        endpoint,
        int((time.perf_counter() - started) * 1000),
        err.status,
        err.code,
        cause,
    )


async def _serve(
    endpoint: str, settings: Settings, work: Callable[[str, float], Awaitable[T]]
) -> T:
    """Run one request body, turning every failure into an ``ExtractorError``."""
    request_id = uuid.uuid4().hex[:12]
    started = time.perf_counter()
    try:
        return await work(request_id, started)
    except ExtractorError as err:
        _log_failure(endpoint, request_id, started, err, err)
        raise
    except Exception as exc:
        err = translate_error(exc, settings)
        _log_failure(endpoint, request_id, started, exc, err)
        raise err from None


# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------


def create_app() -> FastAPI:
    """Build the app. CORS origins are read from the environment here, once."""
    application = FastAPI(
        title="VerifyStack Extractor",
        description="Document extraction and calendar ledger filling. Models propose, code disposes.",
        version=__version__,
    )
    application.add_middleware(
        CORSMiddleware,
        allow_origins=list(get_settings().cors_origins),
        allow_credentials=False,
        allow_methods=["GET", "POST"],
        allow_headers=["X-Extractor-Key", "Content-Type"],
    )

    @application.exception_handler(ExtractorError)
    async def _extractor_error(_: Request, exc: ExtractorError) -> JSONResponse:
        return _error_response(exc)

    @application.exception_handler(RequestValidationError)
    async def _validation_error(_: Request, __: RequestValidationError) -> JSONResponse:
        return _error_response(ExtractorError(400, "bad_request", "The request is not valid"))

    @application.exception_handler(StarletteHTTPException)
    async def _http_error(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        codes = {404: "not_found", 405: "method_not_allowed"}
        code = codes.get(exc.status_code, "bad_request" if exc.status_code < 500 else "internal_error")
        message = {
            "not_found": "Not found",
            "method_not_allowed": "Method not allowed",
        }.get(code, "The request could not be processed")
        return _error_response(ExtractorError(exc.status_code, code, message))

    @application.exception_handler(Exception)
    async def _unexpected(_: Request, exc: Exception) -> JSONResponse:
        err = translate_error(exc)
        logger.error("unhandled exception class=%s status=%d", type(exc).__name__, err.status)
        return _error_response(err)

    @application.get("/health", response_model=HealthResponse)
    def health(settings: Settings = Depends(get_settings)) -> HealthResponse:
        return HealthResponse(
            service=SERVICE_NAME,
            version=__version__,
            gemini_configured=bool(settings.gemini_api_key),
            model=settings.model,
        )

    guarded = [Depends(require_key)]

    @application.get("/v1/template", dependencies=guarded)
    async def template(year: str | None = None) -> Response:
        """The calendar template workbook for a fiscal year (default: the current one)."""
        try:
            data = await run_in_threadpool(build_calendar_template, year if year else None)
        except ValueError:
            raise ExtractorError(
                400, "bad_request", "year is not a fiscal year label such as FY2025-26"
            ) from None
        label = re.sub(r"[^A-Za-z0-9_-]", "", year or "") or "current"
        return Response(
            content=data,
            media_type=XLSX_MEDIA_TYPE,
            headers={
                "Content-Disposition": f'attachment; filename="verifystack_calendar_template_{label}.xlsx"'
            },
        )

    @application.post("/v1/classify", dependencies=guarded)
    async def classify_route(
        request: Request,
        settings: Settings = Depends(get_settings),
        models: ModelProvider = Depends(get_model_provider),
    ) -> Any:
        async def work(request_id: str, started: float) -> Any:
            form = await _read_form(
                request, limit=settings.max_upload_bytes + _FORM_OVERHEAD_BYTES, max_files=1
            )
            try:
                upload = _upload_of(form, "file")
                allowed = _json_of(form, "allowed_doc_types", _DOC_TYPES)
                page = _page_number_of(form)
                data = await read_capped(upload, settings.max_upload_bytes)
            finally:
                await form.close()
            result = await classify(
                Upload(upload.filename or "", data),
                allowed,
                PipelineDeps(settings, models),
                page_number=page,
            )
            digest = await run_in_threadpool(_sha256, data)
            _log(
                "classify", request_id, started,
                sha256=digest, size=len(data), format=_sniff_format(data),
                model_calls=result.run.model_calls,
            )
            return result

        return await _serve("classify", settings, work)

    @application.post("/v1/classify-batch", dependencies=guarded)
    async def classify_batch_route(
        request: Request,
        settings: Settings = Depends(get_settings),
        models: ModelProvider = Depends(get_model_provider),
    ) -> Any:
        async def work(request_id: str, started: float) -> Any:
            limit = settings.max_upload_bytes * settings.max_batch + _FORM_OVERHEAD_BYTES
            form = await _read_form(request, limit=limit, max_files=settings.max_batch + 1)
            try:
                parts = [p for p in form.getlist("files") if p is not None]
                if not parts or not all(isinstance(p, UploadFile) for p in parts):
                    raise ExtractorError(400, "bad_request", "The file field 'files' is required")
                if len(parts) > settings.max_batch:
                    raise ExtractorError(
                        400, "bad_request", f"A batch holds at most {settings.max_batch} files"
                    )
                allowed = _json_of(form, "allowed_doc_types", _DOC_TYPES)
                uploads = [
                    Upload(p.filename or "", await read_capped(p, settings.max_upload_bytes))
                    for p in parts
                    if isinstance(p, UploadFile)
                ]
            finally:
                await form.close()
            result = await classify_batch(uploads, allowed, PipelineDeps(settings, models))
            _log(
                "classify-batch", request_id, started,
                files=len(uploads), size=sum(len(u.data) for u in uploads),
                items_failed=sum(1 for i in result.items if i.error),
                model_calls=result.run.model_calls,
            )
            return result

        return await _serve("classify-batch", settings, work)

    @application.post("/v1/extract-fields", dependencies=guarded)
    async def extract_fields_route(
        request: Request,
        settings: Settings = Depends(get_settings),
        models: ModelProvider = Depends(get_model_provider),
    ) -> Any:
        async def work(request_id: str, started: float) -> Any:
            form = await _read_form(
                request, limit=settings.max_upload_bytes + _FORM_OVERHEAD_BYTES, max_files=1
            )
            try:
                upload = _upload_of(form, "file")
                doc_type = (_text_of(form, "doc_type", required=True) or "").strip()
                if not doc_type:
                    raise ExtractorError(400, "bad_request", "The field 'doc_type' is required")
                catalogue = _json_of(form, "catalogue", _CATALOGUE)
                page = _page_number_of(form)
                params = ExtractFieldsParams(doc_type=doc_type, page_number=page, catalogue=catalogue)
                data = await read_capped(upload, settings.max_upload_bytes)
            finally:
                await form.close()
            result = await extract_fields(
                Upload(upload.filename or "", data),
                params.doc_type,
                params.catalogue,
                params.page_number,
                PipelineDeps(settings, models),
            )
            digest = await run_in_threadpool(_sha256, data)
            _log(
                "extract-fields", request_id, started,
                sha256=digest, size=len(data), format=_sniff_format(data),
                fields=len(result.fields), warnings=len(result.warnings),
                model_calls=result.run.model_calls,
            )
            return result

        return await _serve("extract-fields", settings, work)

    @application.post("/v1/extract-calendar", dependencies=guarded)
    async def extract_calendar_route(
        request: Request,
        settings: Settings = Depends(get_settings),
        models: ModelProvider = Depends(get_model_provider),
    ) -> Any:
        async def work(request_id: str, started: float) -> Any:
            form = await _read_form(
                request, limit=settings.max_upload_bytes + _FORM_OVERHEAD_BYTES, max_files=1
            )
            try:
                upload = _upload_of(form, "file")
                fields: dict[str, Any] = {}
                for name in ("compliance_year", "source_type", "layout"):
                    value = _text_of(form, name)
                    if value is not None and value.strip():
                        fields[name] = value.strip()
                try:
                    params = CalendarParams.model_validate(fields)
                except ValidationError:
                    raise ExtractorError(
                        400, "bad_request", "source_type or layout is not an allowed value"
                    ) from None
                data = await read_capped(upload, settings.max_upload_bytes)
            finally:
                await form.close()
            result = await extract_calendar(
                Upload(upload.filename or "", data), params, PipelineDeps(settings, models)
            )
            _log(
                "extract-calendar", request_id, started,
                sha256=result.file.sha256, size=result.file.size_bytes, format=result.file.format,
                readings=len(result.readings), skipped=len(result.skipped),
                unmapped=len(result.unmapped), warnings=len(result.warnings),
                model_calls=result.run.model_calls,
            )
            return result

        return await _serve("extract-calendar", settings, work)

    return application


app = create_app()
