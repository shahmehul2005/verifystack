"""Command line interface for the Extractor_Service.

Run from the repo root as ``python -m services.extractor.cli``:

* ``serve [--host 127.0.0.1] [--port 8001]`` starts the HTTP service with uvicorn.
* ``extract FILE [--year FY2025-26] [--source corroboration] [--layout auto]`` runs the
  calendar pipeline on one file and prints the API response body as JSON.
* ``template OUT [--year FY2025-26]`` writes the calendar template workbook.

``extract`` and ``template`` write only JSON to stdout, so a caller can parse it. On a
failure they print the same error body the API returns and exit with status 1. A usage
error exits with status 2. Nothing else is written to stdout: argparse writes to stderr
and the package silences the pydantic-ai banner.

The heavy imports (FastAPI, uvicorn, pydantic-ai) happen inside the commands that need
them, so ``--help`` and ``template`` stay fast and independent of the API module.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from collections.abc import Sequence
from pathlib import Path
from typing import Any

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8001

EXIT_OK = 0
EXIT_FAILURE = 1
EXIT_USAGE = 2  # argparse uses 2 for usage errors too


def _emit(body: dict[str, Any]) -> None:
    """Print one JSON document to stdout."""
    sys.stdout.write(json.dumps(body, ensure_ascii=False, indent=2))
    sys.stdout.write("\n")
    sys.stdout.flush()


def _error_body(
    code: str,
    message: str,
    *,
    category: str | None = None,
    supported: Sequence[str] | None = None,
) -> dict[str, Any]:
    """The error envelope of the HTTP contract: ``{ok: false, error: {...}}``."""
    error: dict[str, Any] = {"code": code, "message": message, "category": category}
    if supported is not None:
        error["supported"] = list(supported)
    return {"ok": False, "error": error}


def _fail(
    code: str,
    message: str,
    *,
    category: str | None = None,
    supported: Sequence[str] | None = None,
) -> int:
    _emit(_error_body(code, message, category=category, supported=supported))
    return EXIT_FAILURE


# ---------------------------------------------------------------------------
# serve
# ---------------------------------------------------------------------------


def _cmd_serve(args: argparse.Namespace) -> int:
    import uvicorn

    uvicorn.run("services.extractor.api:app", host=args.host, port=args.port)
    return EXIT_OK


# ---------------------------------------------------------------------------
# extract
# ---------------------------------------------------------------------------


def _cmd_extract(args: argparse.Namespace) -> int:
    from .agents import ModelNotConfigured, build_model_provider, not_configured_message
    from .config import get_settings
    from .models import CalendarParams, SourceType
    from .pdf_text import PageCapExceeded
    from .pipeline import (
        LayoutNotRecognized,
        ModelFailure,
        PipelineDeps,
        Upload,
        extract_calendar,
    )
    from .workbook import CorruptFile, PasswordProtected, UnsupportedFormat

    settings = get_settings()
    path = Path(args.file)
    try:
        size = path.stat().st_size
    except OSError:
        return _fail("bad_request", f"Cannot read file: {path.name}")
    if not path.is_file():
        return _fail("bad_request", f"Not a file: {path.name}")
    if size > settings.max_upload_bytes:
        limit_mb = settings.max_upload_bytes // (1024 * 1024)
        return _fail("file_too_large", f"File exceeds {limit_mb} MB")
    try:
        data = path.read_bytes()
    except OSError:
        return _fail("bad_request", f"Cannot read file: {path.name}")

    params = CalendarParams(
        compliance_year=args.year,
        source_type=SourceType(args.source),
        layout=args.layout,
    )
    try:
        deps = PipelineDeps(settings=settings, models=build_model_provider(settings))
        response = asyncio.run(extract_calendar(Upload(name=path.name, data=data), params, deps))
    except UnsupportedFormat as exc:
        return _fail("unsupported_format", str(exc), supported=exc.supported)
    except PasswordProtected as exc:
        return _fail("password_protected", str(exc))
    except CorruptFile as exc:
        return _fail("corrupt_file", str(exc))
    except LayoutNotRecognized as exc:
        return _fail("layout_not_recognized", str(exc))
    except PageCapExceeded as exc:
        return _fail("page_cap_exceeded", str(exc))
    except ModelNotConfigured as exc:
        return _fail("gemini_key_missing", not_configured_message(exc))
    except ModelFailure as exc:
        return _fail("model_failure", "A model call failed", category=exc.category)
    except Exception as exc:  # noqa: BLE001 - last resort, report the class name only
        # The message can carry document content or a credential, so it is not printed.
        return _fail("internal_error", f"Unexpected {type(exc).__name__}")

    _emit(response.model_dump(mode="json"))
    return EXIT_OK


# ---------------------------------------------------------------------------
# template
# ---------------------------------------------------------------------------


def _cmd_template(args: argparse.Namespace) -> int:
    from .workbook import build_calendar_template

    try:
        data = build_calendar_template(args.year)
    except ValueError as exc:
        return _fail("bad_request", str(exc))

    out = Path(args.out)
    try:
        out.write_bytes(data)
    except OSError:
        return _fail("bad_request", f"Cannot write file: {out.name}")

    _emit({"ok": True, "output": str(out), "size_bytes": len(data)})
    return EXIT_OK


# ---------------------------------------------------------------------------
# Parser
# ---------------------------------------------------------------------------


def build_parser() -> argparse.ArgumentParser:
    from .models import SourceType

    parser = argparse.ArgumentParser(
        prog="python -m services.extractor.cli",
        description="VerifyStack Extractor_Service command line.",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    p_serve = sub.add_parser("serve", help="Start the HTTP service")
    p_serve.add_argument("--host", default=DEFAULT_HOST, help=f"Bind address (default {DEFAULT_HOST})")
    p_serve.add_argument(
        "--port", type=int, default=DEFAULT_PORT, help=f"Port (default {DEFAULT_PORT})"
    )
    p_serve.set_defaults(func=_cmd_serve)

    p_extract = sub.add_parser("extract", help="Extract calendar readings from one file")
    p_extract.add_argument("file", metavar="FILE", help="Path to an xlsx, xls, csv or pdf file")
    p_extract.add_argument(
        "--year", default=None, help="Compliance year label, for example FY2025-26"
    )
    p_extract.add_argument(
        "--source",
        default=SourceType.CORROBORATION.value,
        choices=[s.value for s in SourceType],
        help="Evidence layer (default corroboration)",
    )
    p_extract.add_argument(
        "--layout",
        default="auto",
        choices=["auto", "proforma", "tabular"],
        help="Spreadsheet layout (default auto)",
    )
    p_extract.set_defaults(func=_cmd_extract)

    p_template = sub.add_parser("template", help="Write the calendar template workbook")
    p_template.add_argument("out", metavar="OUT", help="Output .xlsx path")
    p_template.add_argument(
        "--year", default=None, help="Compliance year label, for example FY2025-26"
    )
    p_template.set_defaults(func=_cmd_template)

    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return int(args.func(args))


if __name__ == "__main__":
    sys.exit(main())
