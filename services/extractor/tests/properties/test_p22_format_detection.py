"""Property 22: Format detection.

Feature: industrial-extractor, Property 22: Format detection.

For any generated xlsx, xls, csv or pdf file and any file extension, detection returns the
true format, and when the extension disagrees the result has an ``extension_mismatch``
warning and the same readings as the correct extension. For any bytes that match no
supported format, including a ZIP without ``xl/workbook.xml``, the response is 415 with the
supported list.

xls files are synthetic OLE2 containers here, because the test tree has no xls writer. They
exercise detection only. Reading an xls is covered by the workbook unit tests.

**Validates: Requirements 8.1, 8.2, 8.3**
"""

from __future__ import annotations

import asyncio
import csv
import io
import zipfile

import pytest
from fastapi.testclient import TestClient
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from services.extractor.config import get_settings
from services.extractor.models import CalendarParams
from services.extractor.pipeline import PipelineDeps, Upload, extract_calendar
from services.extractor.tests.conftest import FixedModelProvider, ModelScript, make_function_model
from services.extractor.tests.factories import long_table, text_pdf
from services.extractor.workbook import SUPPORTED_FORMATS, UnsupportedFormat, detect_format

FY = "FY2023-24"
OLE2_MAGIC = bytes.fromhex("D0CF11E0A1B11AE1")

# Extensions that name a spreadsheet or PDF format, and the format each one means.
KNOWN_EXTENSIONS = {
    "xlsx": "xlsx",
    "xlsm": "xlsx",
    "xls": "xls",
    "csv": "csv",
    "tsv": "csv",
    "txt": "csv",
    "pdf": "pdf",
}
extensions = st.one_of(
    st.sampled_from(sorted(KNOWN_EXTENSIONS)),
    st.sampled_from(["", "png", "docx", "json"]),
    st.text(alphabet="abcdefghijklmnopqrstuvwxyz0123456789", min_size=1, max_size=6),
)
stems = st.text(alphabet="abcdefghijklmnopqrstuvwxyz_-", min_size=1, max_size=12)


def csv_bytes(records: list[tuple[str, str, int, str]], delimiter: str) -> bytes:
    out = io.StringIO(newline="")
    writer = csv.writer(out, delimiter=delimiter, lineterminator="\n")
    writer.writerow(["Month", "Stream", "Value", "Unit"])
    writer.writerows(records)
    return out.getvalue().encode("utf-8")


@st.composite
def calendar_records(draw: st.DrawFn) -> list[tuple[str, str, int, str]]:
    """Rule-mapped rows, so no model is needed."""
    months = draw(st.lists(st.sampled_from(["Apr-2023", "May-2023", "Jun-2023", "Jul-2023"]),
                           min_size=1, max_size=4, unique=True))
    streams = draw(st.lists(st.sampled_from(["coal_quantity", "clinker_production"]),
                            min_size=1, max_size=2, unique=True))
    return [(m, s, draw(st.integers(1, 10**6)), "t") for m in months for s in streams]


@st.composite
def files(draw: st.DrawFn) -> tuple[str, bytes]:
    """``(true_format, bytes)`` for a generated xlsx, xls, csv or pdf file."""
    fmt = draw(st.sampled_from(["xlsx", "xls", "csv", "pdf"]))
    if fmt == "xlsx":
        return fmt, long_table(draw(calendar_records()))
    if fmt == "csv":
        return fmt, csv_bytes(draw(calendar_records()), draw(st.sampled_from([",", ";", "\t", "|"])))
    if fmt == "pdf":
        lines = draw(st.lists(st.text(alphabet="abcdefg 0123456789", max_size=30), max_size=5))
        return fmt, text_pdf(lines or ["x"])
    pad = draw(st.integers(0, 200))
    body = "Workbook".encode("utf-16-le") if draw(st.booleans()) else "Book".encode("utf-16-le")
    return fmt, OLE2_MAGIC + b"\x00" * pad + body + b"\x00" * 16


def _deps() -> PipelineDeps:
    return PipelineDeps(get_settings(), FixedModelProvider(make_function_model(ModelScript())))


def _extract(name: str, data: bytes):  # type: ignore[no-untyped-def]
    return asyncio.run(extract_calendar(Upload(name, data), CalendarParams(compliance_year=FY), _deps()))


def _readings(result) -> list[dict]:  # type: ignore[no-untyped-def,type-arg]
    return [r.model_dump(mode="json") for r in result.readings]


@settings(max_examples=100, deadline=None)
@given(files())
def test_detection_returns_the_true_format(case: tuple[str, bytes]) -> None:
    fmt, data = case
    assert detect_format(data) == fmt


@settings(max_examples=60, deadline=None)
@given(
    case=st.tuples(st.sampled_from(["xlsx", "csv"]), calendar_records(), st.sampled_from([",", ";", "\t"])),
    stem=stems,
    ext=extensions,
)
def test_extension_never_changes_readings_and_a_mismatch_warns(
    case: tuple[str, list[tuple[str, str, int, str]], str], stem: str, ext: str
) -> None:
    fmt, records, delimiter = case
    data = long_table(records) if fmt == "xlsx" else csv_bytes(records, delimiter)
    name = f"{stem}.{ext}" if ext else stem

    reference = _extract(f"{stem}.{fmt}", data)
    result = _extract(name, data)

    assert result.file.format == fmt
    assert _readings(result) == _readings(reference)
    assert reference.readings
    assert "extension_mismatch" not in [w.code for w in reference.warnings]

    codes = [w.code for w in result.warnings]
    agrees = not ext or KNOWN_EXTENSIONS.get(ext, ext) == fmt
    assert ("extension_mismatch" in codes) == (not agrees)


@st.composite
def unsupported_bytes(draw: st.DrawFn) -> bytes:
    kind = draw(st.sampled_from(["binary", "zip", "ole2", "png"]))
    if kind == "binary":
        # A leading NUL byte keeps it out of every text and magic-byte rule.
        return b"\x00" + draw(st.binary(min_size=0, max_size=300))
    if kind == "png":
        return b"\x89PNG\r\n\x1a\n" + draw(st.binary(max_size=100))
    if kind == "ole2":
        # Zero filler holds neither the Workbook nor the Book stream name.
        return OLE2_MAGIC + b"\x00" * draw(st.integers(0, 300))
    buf = io.BytesIO()
    names = draw(
        st.lists(
            st.sampled_from(["a.txt", "docs/readme.md", "xl/sharedStrings.xml", "[Content_Types].xml",
                             "word/document.xml", "xl/worksheets/sheet1.xml"]),
            max_size=4,
            unique=True,
        )
    )
    with zipfile.ZipFile(buf, "w") as zf:
        for n in names:
            zf.writestr(n, "x")
        if not names:
            zf.writestr("empty.txt", "")
    return buf.getvalue()


@settings(max_examples=100, deadline=None)
@given(unsupported_bytes())
def test_unsupported_content_is_rejected_with_the_supported_list(data: bytes) -> None:
    with pytest.raises(UnsupportedFormat) as info:
        detect_format(data)
    assert set(getattr(info.value, "supported", SUPPORTED_FORMATS)) >= {"xlsx", "xls", "csv", "pdf"}


@settings(
    max_examples=15, deadline=None, suppress_health_check=[HealthCheck.function_scoped_fixture]
)
@given(data=unsupported_bytes(), ext=st.sampled_from(["xlsx", "xls", "csv", "pdf"]))
def test_api_answers_415_with_the_supported_list(
    client: TestClient, auth_headers: dict[str, str], data: bytes, ext: str
) -> None:
    response = client.post(
        "/v1/extract-calendar",
        headers=auth_headers,
        files={"file": (f"upload.{ext}", data, "application/octet-stream")},
        data={"compliance_year": FY},
    )
    assert response.status_code == 415
    error = response.json()["error"]
    assert error["code"] == "unsupported_format"
    assert set(error["supported"]) == set(SUPPORTED_FORMATS)
