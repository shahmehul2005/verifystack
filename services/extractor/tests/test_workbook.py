"""Unit tests for ``workbook.py``: format detection, loaders, A1 helpers and the evaluator.

Covers Requirements 6.7, 6.8, 6.9 (Formula_Evaluator) and 8.1 to 8.4 (format detection and
failure modes). Spreadsheet fixtures come from openpyxl (``factories.py``) or are built in
memory, so no binary file is checked in.
"""

from __future__ import annotations

import ast
import io
import re
import zipfile
from datetime import datetime
from decimal import Decimal
from pathlib import Path
from typing import Any

import openpyxl
import pytest

from services.extractor import workbook as wbmod
from services.extractor.tests.factories import (
    long_table,
    proforma_workbook,
    with_merged_header,
)
from services.extractor.workbook import (
    CorruptFile,
    FormulaEvaluator,
    PasswordProtected,
    UnsupportedFormat,
    Workbook,
    a1,
    build_calendar_template,
    detect_format,
    load_workbook_bytes,
    make_raw_id,
    parse_a1,
    split_raw_id,
    template_months,
)

OLE2_MAGIC = bytes.fromhex("D0CF11E0A1B11AE1")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _xlsx(build: Any) -> bytes:
    wb = openpyxl.Workbook()
    ws = wb.active
    build(ws, wb)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def _fake_xls(*, encrypted: bool = False) -> bytes:
    """Bytes that look like an OLE2 xls container (not a readable workbook)."""
    body = "Workbook".encode("utf-16-le")
    if encrypted:
        body += "EncryptedPackage".encode("utf-16-le")
    return OLE2_MAGIC + b"\x00" * 64 + body + b"\x00" * 64


def _evaluator(sheets: dict[str, dict[str, Any]], epoch: int = 1900) -> FormulaEvaluator:
    """An evaluator over a hand-built workbook.

    ``sheets`` maps a sheet name to ``{"B2": value_or_formula}``. A string that starts with
    ``=`` is stored as a formula with no cached value.
    """
    built = []
    for name, cells in sheets.items():
        sh = wbmod.Sheet(name=name)
        for ref, v in cells.items():
            row, col = parse_a1(ref)
            if isinstance(v, str) and v.startswith("="):
                sh.cells[(row, col)] = wbmod.Cell(name, row, col, None, v)
            else:
                sh.cells[(row, col)] = wbmod.Cell(name, row, col, v)
        built.append(sh)
    return FormulaEvaluator(Workbook(sheets=built, epoch=epoch))  # type: ignore[arg-type]


def _eval(formula: str, sheets: dict[str, dict[str, Any]] | None = None) -> wbmod.EvalResult:
    ev = _evaluator(sheets or {"S": {}})
    first = next(iter((sheets or {"S": {}}).keys()))
    return ev.evaluate_formula(formula, first)


def _value(formula: str, sheets: dict[str, dict[str, Any]] | None = None) -> Decimal:
    result = _eval(formula, sheets)
    assert result.warning is None, result.warning
    assert result.value is not None
    return result.value


# ---------------------------------------------------------------------------
# Format detection (Requirement 8.1)
# ---------------------------------------------------------------------------


class TestDetectFormat:
    def test_pdf(self) -> None:
        assert detect_format(b"%PDF-1.7\n%...") == "pdf"

    def test_pdf_with_leading_bytes(self) -> None:
        assert detect_format(b"\xef\xbb\xbf  \n%PDF-1.4\n") == "pdf"

    def test_xlsx(self) -> None:
        data = proforma_workbook([("Clinker (t)", 10)])
        assert detect_format(data) == "xlsx"

    def test_xls_by_ole2_signature(self) -> None:
        assert detect_format(_fake_xls()) == "xls"

    @pytest.mark.parametrize("delim", [",", ";", "\t", "|"])
    def test_csv_delimiters(self, delim: str) -> None:
        text = delim.join(["Month", "Stream", "Value"]) + "\n"
        text += delim.join(["2025-04", "clinker_production", "100"]) + "\n"
        text += delim.join(["2025-05", "clinker_production", "120"]) + "\n"
        assert detect_format(text.encode()) == "csv"

    def test_csv_with_utf8_bom(self) -> None:
        text = "\ufeffa,b\n1,2\n3,4\n"
        assert detect_format(text.encode("utf-8")) == "csv"

    def test_csv_utf16_with_bom(self) -> None:
        text = "a,b\n1,2\n3,4\n"
        assert detect_format(text.encode("utf-16")) == "csv"

    def test_csv_cp1252(self) -> None:
        text = "Plant,Value\nCaf\u00e9 kiln,1\nSecond,2\n"
        assert detect_format(text.encode("cp1252")) == "csv"

    def test_detection_ignores_everything_but_content(self) -> None:
        # Requirement 8.2: the extension is never an input. The same bytes always give the
        # same answer, so a ``.csv`` that holds an xlsx is read as xlsx.
        xlsx = proforma_workbook([("Clinker (t)", 10)])
        csv_bytes = b"Month,Value\n2025-04,1\n2025-05,2\n"
        assert detect_format(xlsx) == "xlsx"
        assert detect_format(csv_bytes) == "csv"

    @pytest.mark.parametrize(
        "data",
        [
            b"",
            b"just one line of text, no table",
            b"\x00\x01\x02\x03binary\xff\xfe\x00data",
            b"\x89PNG\r\n\x1a\n" + b"\x00" * 32,
            b"MZ\x90\x00" + b"\x00" * 64,
        ],
        ids=["empty", "single_line", "binary", "png", "exe"],
    )
    def test_unsupported_content(self, data: bytes) -> None:
        with pytest.raises(UnsupportedFormat):
            detect_format(data)

    def test_unsupported_lists_supported_formats(self) -> None:
        # Requirement 8.3: the error carries the supported list for the 415 body.
        with pytest.raises(UnsupportedFormat) as info:
            detect_format(b"\x89PNG\r\n\x1a\n" + b"\x00" * 32)
        assert set(info.value.supported) == {"xlsx", "xls", "csv", "pdf"}

    def test_non_bytes_input_is_unsupported(self) -> None:
        with pytest.raises(UnsupportedFormat):
            detect_format("text")  # type: ignore[arg-type]

    def test_zip_that_is_not_xlsx(self) -> None:
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            zf.writestr("readme.txt", "hello")
        with pytest.raises(UnsupportedFormat):
            detect_format(buf.getvalue())

    def test_ole2_that_is_not_xls(self) -> None:
        with pytest.raises(UnsupportedFormat):
            detect_format(OLE2_MAGIC + b"\x00" * 200)


# ---------------------------------------------------------------------------
# Corrupt and password-protected files (Requirement 8.4)
# ---------------------------------------------------------------------------


class TestCorruptAndProtected:
    def test_truncated_zip_is_corrupt(self) -> None:
        data = proforma_workbook([("Clinker (t)", 10)])
        with pytest.raises(CorruptFile):
            detect_format(data[: len(data) // 2])

    def test_zip_magic_with_garbage_is_corrupt(self) -> None:
        with pytest.raises(CorruptFile):
            detect_format(b"PK\x03\x04" + b"garbage" * 20)

    def test_encrypted_ole2_is_password_protected(self) -> None:
        with pytest.raises(PasswordProtected):
            detect_format(_fake_xls(encrypted=True))

    def test_encrypted_xlsx_load_is_password_protected(self) -> None:
        with pytest.raises(PasswordProtected):
            load_workbook_bytes(_fake_xls(encrypted=True), "xlsx")

    def test_encrypted_xls_load_is_password_protected(self) -> None:
        with pytest.raises(PasswordProtected):
            load_workbook_bytes(_fake_xls(encrypted=True), "xls")

    def test_xlsx_with_unreadable_parts_is_corrupt(self) -> None:
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            zf.writestr("[Content_Types].xml", "not xml")
            zf.writestr("xl/workbook.xml", "not xml either")
        data = buf.getvalue()
        assert detect_format(data) == "xlsx"
        with pytest.raises(CorruptFile):
            load_workbook_bytes(data, "xlsx")

    def test_non_zip_bytes_loaded_as_xlsx_are_corrupt(self) -> None:
        with pytest.raises(CorruptFile):
            load_workbook_bytes(b"this is not a zip file", "xlsx")

    def test_damaged_xls_is_corrupt(self) -> None:
        with pytest.raises(CorruptFile):
            load_workbook_bytes(_fake_xls(), "xls")

    def test_binary_bytes_loaded_as_csv_are_corrupt(self) -> None:
        with pytest.raises(CorruptFile):
            load_workbook_bytes(b"\x00\x01\x02\x03", "csv")

    def test_csv_without_delimiter_is_corrupt(self) -> None:
        with pytest.raises(CorruptFile):
            load_workbook_bytes(b"one line only", "csv")

    @pytest.mark.parametrize("fmt", ["pdf", "docx", ""])
    def test_non_spreadsheet_format_is_rejected(self, fmt: str) -> None:
        with pytest.raises(UnsupportedFormat):
            load_workbook_bytes(b"%PDF-1.4", fmt)


# ---------------------------------------------------------------------------
# Loaders
# ---------------------------------------------------------------------------


class TestLoadXlsx:
    def test_values_and_real_cell_positions(self) -> None:
        data = proforma_workbook(
            [("Clinker production (t)", 150000)], sheet="Form-Sb", row_offset=2, col_offset=1
        )
        wb = load_workbook_bytes(data, "xlsx")
        assert wb.fmt == "xlsx"
        assert [s.name for s in wb.sheets] == ["Form-Sb"]
        sh = wb.sheets[0]
        label = sh.cell(3, 2)
        assert label is not None and label.value == "Clinker production (t)"
        assert label.ref == "B3"
        value = sh.cell(3, 3)
        assert value is not None and value.value == 150000 and value.ref == "C3"
        assert (sh.max_row, sh.max_col) == (3, 3)

    def test_empty_cells_are_not_stored(self) -> None:
        def build(ws: Any, wb: Any) -> None:
            ws["A1"] = "x"
            ws["C3"] = "y"
            ws["B2"] = ""

        sh = load_workbook_bytes(_xlsx(build), "xlsx").sheets[0]
        assert set(sh.cells) == {(1, 1), (3, 3)}

    def test_formula_text_kept_with_leading_equals(self) -> None:
        def build(ws: Any, wb: Any) -> None:
            ws["A1"] = 5
            ws["B1"] = "=A1*2"

        cell = load_workbook_bytes(_xlsx(build), "xlsx").sheets[0].cell(1, 2)
        assert cell is not None
        assert cell.formula == "=A1*2"
        assert cell.value is None  # openpyxl writes no cached value

    def test_cached_value_is_read_next_to_formula_text(self) -> None:
        def build(ws: Any, wb: Any) -> None:
            ws["A1"] = 5
            ws["B1"] = "=A1*2"

        data = _xlsx(build)
        # Inject a cached value the way Excel stores one.
        src = zipfile.ZipFile(io.BytesIO(data))
        out = io.BytesIO()
        with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as dst:
            for item in src.infolist():
                content = src.read(item.filename)
                if item.filename == "xl/worksheets/sheet1.xml":
                    xml = content.decode()
                    patched = re.sub(r"(<f>A1\*2</f>)\s*<v\s*/>|(<f>A1\*2</f>)<v></v>", r"<f>A1*2</f><v>10</v>", xml)
                    assert patched != xml, "fixture patch did not apply"
                    content = patched.encode()
                dst.writestr(item, content)
        cell = load_workbook_bytes(out.getvalue(), "xlsx").sheets[0].cell(1, 2)
        assert cell is not None
        assert cell.formula == "=A1*2"
        assert cell.value == 10

    def test_multiple_sheets_keep_order(self) -> None:
        def build(ws: Any, wb: Any) -> None:
            ws.title = "First"
            ws["A1"] = 1
            wb.create_sheet("Second")["A1"] = 2
            wb.create_sheet("Third")["A1"] = 3

        wb = load_workbook_bytes(_xlsx(build), "xlsx")
        assert [s.name for s in wb.sheets] == ["First", "Second", "Third"]
        assert wb.sheet("Second") is not None
        assert wb.sheet("Nope") is None

    def test_date_cell_is_marked(self) -> None:
        def build(ws: Any, wb: Any) -> None:
            ws["A1"] = datetime(2025, 4, 1)
            ws["A2"] = 45748

        sh = load_workbook_bytes(_xlsx(build), "xlsx").sheets[0]
        d, n = sh.cell(1, 1), sh.cell(2, 1)
        assert d is not None and d.is_date and d.value == datetime(2025, 4, 1)
        assert n is not None and not n.is_date

    def test_epoch_1900_default_and_1904(self) -> None:
        def build(ws: Any, wb: Any) -> None:
            ws["A1"] = 1

        assert load_workbook_bytes(_xlsx(build), "xlsx").epoch == 1900

        def build_mac(ws: Any, wb: Any) -> None:
            from openpyxl.utils.datetime import CALENDAR_MAC_1904

            wb.epoch = CALENDAR_MAC_1904
            ws["A1"] = 1

        assert load_workbook_bytes(_xlsx(build_mac), "xlsx").epoch == 1904

    def test_columns_beyond_z_keep_their_address(self) -> None:
        def build(ws: Any, wb: Any) -> None:
            ws["AB5"] = "far"
            ws["XFD10"] = "edge"

        sh = load_workbook_bytes(_xlsx(build), "xlsx").sheets[0]
        cell = sh.cell(5, 28)
        assert cell is not None and cell.ref == "AB5" and cell.raw_id == f"{sh.name}!AB5"
        edge = sh.cell(10, 16384)
        assert edge is not None and edge.ref == "XFD10"
        assert sh.max_col == 16384

    def test_template_round_trips_through_the_loader(self) -> None:
        wb = load_workbook_bytes(build_calendar_template("FY2025-26"), "xlsx")
        assert [s.name for s in wb.sheets] == ["Calendar", "Streams", "Instructions"]
        header = [wb.sheets[0].cell(1, c).value for c in range(1, 6)]  # type: ignore[union-attr]
        assert header == ["Month", "Stream", "Value", "Unit", "Source"]


class TestMergedRanges:
    def test_merged_ranges_are_recorded(self) -> None:
        data = with_merged_header(
            [("Coal", ["Quantity (t)", "GCV (kcal/kg)"])], ["2025-04"], [[10, 5000]]
        )
        sh = load_workbook_bytes(data, "xlsx").sheets[0]
        spans = {(r.min_row, r.min_col, r.max_row, r.max_col) for r in sh.merged}
        assert (1, 1, 2, 1) in spans  # period header merged down
        assert (1, 2, 1, 3) in spans  # group title merged across

    def test_header_cell_expands_a_merge_but_cell_does_not(self) -> None:
        data = with_merged_header(
            [("Coal", ["Quantity (t)", "GCV (kcal/kg)"])], ["2025-04"], [[10, 5000]]
        )
        sh = load_workbook_bytes(data, "xlsx").sheets[0]
        assert sh.cell(1, 3) is None  # data access never fills from a merge
        assert sh.header_value(1, 2) == "Coal"
        assert sh.header_value(1, 3) == "Coal"  # header access does
        assert sh.header_value(2, 1) == "Month"
        assert sh.header_value(2, 3) == "GCV (kcal/kg)"  # outside the merge, own value

    def test_merged_range_contains(self) -> None:
        rng = wbmod.MergedRange(2, 2, 4, 5)
        assert rng.contains(2, 2) and rng.contains(4, 5) and rng.contains(3, 3)
        assert not rng.contains(1, 2) and not rng.contains(5, 5) and not rng.contains(3, 6)

    def test_header_cell_outside_any_merge(self) -> None:
        sh = wbmod.Sheet(name="S")
        sh.cells[(1, 1)] = wbmod.Cell("S", 1, 1, "x")
        assert sh.merged_range_at(1, 1) is None
        assert sh.header_value(1, 1) == "x"
        assert sh.header_value(9, 9) is None


class TestLoadCsv:
    def test_cells_are_stripped_strings_with_real_positions(self) -> None:
        csv_bytes = b"Month, Stream ,Value\n2025-04,clinker_production, 100 \n2025-05,,120\n"
        wb = load_workbook_bytes(csv_bytes, "csv")
        assert wb.fmt == "csv" and wb.epoch == 1900
        sh = wb.sheets[0]
        assert sh.name == "Sheet1"
        assert sh.cell(1, 2).value == "Stream"  # type: ignore[union-attr]
        assert sh.cell(2, 3).value == "100"  # type: ignore[union-attr]
        assert sh.cell(3, 2) is None  # empty field is not stored
        assert (sh.max_row, sh.max_col) == (3, 3)
        assert all(c.formula is None and not c.is_date for c in sh.cells.values())

    def test_semicolon_delimiter(self) -> None:
        sh = load_workbook_bytes(b"a;b;c\n1;2;3\n4;5;6\n", "csv").sheets[0]
        assert sh.cell(3, 3).value == "6"  # type: ignore[union-attr]

    def test_quoted_field_keeps_embedded_delimiter(self) -> None:
        sh = load_workbook_bytes(b'name,value\n"Coal, imported",5\nother,6\n', "csv").sheets[0]
        assert sh.cell(2, 1).value == "Coal, imported"  # type: ignore[union-attr]

    def test_bom_is_dropped_from_first_cell(self) -> None:
        sh = load_workbook_bytes("\ufeffMonth,Value\n1,2\n3,4\n".encode(), "csv").sheets[0]
        assert sh.cell(1, 1).value == "Month"  # type: ignore[union-attr]

    def test_utf16_csv_loads(self) -> None:
        sh = load_workbook_bytes("a,b\n1,2\n3,4\n".encode("utf-16"), "csv").sheets[0]
        assert sh.cell(3, 2).value == "4"  # type: ignore[union-attr]

    def test_long_table_built_as_xlsx_loads_the_same_cells_as_csv(self) -> None:
        records = [("2025-04", "clinker_production", 100, "t")]
        xlsx = load_workbook_bytes(long_table(records), "xlsx").sheets[0]
        csv_sh = load_workbook_bytes(
            b"Month,Stream,Value,Unit\n2025-04,clinker_production,100,t\n", "csv"
        ).sheets[0]
        assert {k: str(c.value) for k, c in xlsx.cells.items()} == {
            k: str(c.value) for k, c in csv_sh.cells.items()
        }


# ---------------------------------------------------------------------------
# A1 addresses and Raw_Ids (Requirement 6.12)
# ---------------------------------------------------------------------------


class TestAddresses:
    @pytest.mark.parametrize(
        ("row", "col", "text"),
        [
            (1, 1, "A1"),
            (5, 3, "C5"),
            (1, 26, "Z1"),
            (1, 27, "AA1"),
            (1, 28, "AB1"),
            (7, 52, "AZ7"),
            (7, 53, "BA7"),
            (1, 702, "ZZ1"),
            (1, 703, "AAA1"),
            (1048576, 16384, "XFD1048576"),
        ],
    )
    def test_a1_and_parse_a1(self, row: int, col: int, text: str) -> None:
        assert a1(row, col) == text
        assert parse_a1(text) == (row, col)

    def test_round_trip_for_every_column(self) -> None:
        for col in range(1, 16385):
            assert parse_a1(a1(3, col)) == (3, col)

    def test_parse_a1_accepts_absolute_and_lowercase(self) -> None:
        assert parse_a1("$AB$17") == (17, 28)
        assert parse_a1("ab17") == (17, 28)
        assert parse_a1(" C5 ") == (5, 3)

    @pytest.mark.parametrize("bad", ["", "A0", "1A", "A", "XFE1", "AAAA1", "A1048577", "A-1", "A 1"])
    def test_parse_a1_rejects_invalid(self, bad: str) -> None:
        with pytest.raises(ValueError):
            parse_a1(bad)

    def test_parse_a1_rejects_non_string(self) -> None:
        with pytest.raises(ValueError):
            parse_a1(None)  # type: ignore[arg-type]

    @pytest.mark.parametrize("row, col", [(0, 1), (1, 0), (1, 16385), (1048577, 1), (-1, 1)])
    def test_a1_rejects_out_of_range(self, row: int, col: int) -> None:
        with pytest.raises(ValueError):
            a1(row, col)

    def test_raw_id_round_trip(self) -> None:
        raw = make_raw_id("Form-Sb", 12, 28)
        assert raw == "Form-Sb!AB12"
        assert split_raw_id(raw) == ("Form-Sb", "AB12")

    def test_raw_id_splits_on_the_last_bang(self) -> None:
        raw = make_raw_id("Plant!Daily", 3, 2)
        assert split_raw_id(raw) == ("Plant!Daily", "B3")

    def test_split_raw_id_normalizes_the_cell_part(self) -> None:
        assert split_raw_id("S!$ab$3") == ("S", "AB3")

    @pytest.mark.parametrize("bad", ["NoBang", "!A1", "Sheet!", "Sheet!notacell", "Sheet!A0"])
    def test_split_raw_id_rejects_invalid(self, bad: str) -> None:
        with pytest.raises(ValueError):
            split_raw_id(bad)


# ---------------------------------------------------------------------------
# FormulaEvaluator (Requirements 6.6 to 6.9)
# ---------------------------------------------------------------------------


class TestEvaluatorArithmetic:
    @pytest.mark.parametrize(
        ("formula", "expected"),
        [
            ("=1+2", "3"),
            ("=10-4", "6"),
            ("=6*7", "42"),
            ("=1/4", "0.25"),
            ("=2^10", "1024"),
            ("=2+3*4", "14"),
            ("=(2+3)*4", "20"),
            ("=10-3-2", "5"),  # left associative
            ("=100/10/5", "2"),
            ("=2^3^2", "64"),  # Excel: left associative, (2^3)^2
            ("=-2^2", "4"),  # Excel: unary minus binds tighter than ^
            ("=--3", "3"),
            ("=+5", "5"),
            ("=50%", "0.5"),
            ("=200*10%", "20"),
            ("=2^-1", "0.5"),
            ("=0.1+0.2", "0.3"),  # Decimal arithmetic, no float noise
            ("=1.5E2", "150"),
            ("= 1 + 2 ", "3"),
        ],
    )
    def test_operators_and_precedence(self, formula: str, expected: str) -> None:
        assert _value(formula) == Decimal(expected)

    def test_leading_equals_is_optional(self) -> None:
        assert _value("1+1") == Decimal(2)

    @pytest.mark.parametrize(
        ("formula", "expected"),
        [
            ("=SUM(1,2,3)", "6"),
            ("=MIN(4,2,9)", "2"),
            ("=MAX(4,2,9)", "9"),
            ("=ABS(-7.5)", "7.5"),
            ("=ROUND(2.5,0)", "3"),
            ("=ROUND(-2.5,0)", "-3"),  # ties go away from zero
            ("=ROUND(1.005,2)", "1.01"),  # exact Decimal, not float
            ("=ROUND(1234,-2)", "1200"),
            ("=ROUND(2.567,1)", "2.6"),
            ("=sum(1,2)", "3"),
            ("=SUM(1,MAX(2,3))", "4"),
        ],
    )
    def test_functions(self, formula: str, expected: str) -> None:
        assert _value(formula) == Decimal(expected)

    def test_sum_and_aggregates_over_ranges(self) -> None:
        sheets = {"S": {"A1": 1, "A2": 2, "A3": 3, "B1": 10, "B2": "text", "C1": True}}
        assert _value("=SUM(A1:A3)", sheets) == 6
        assert _value("=SUM(A1:B3)", sheets) == 16  # text and booleans are skipped
        assert _value("=MIN(A1:A3)", sheets) == 1
        assert _value("=MAX(A1:B3)", sheets) == 10
        assert _value("=SUM(A3:A1)", sheets) == 6  # reversed corners
        assert _value("=SUM(A1:A3,B1)", sheets) == 16

    def test_empty_cell_counts_as_zero_in_arithmetic(self) -> None:
        assert _value("=A1+5", {"S": {"B1": 1}}) == 5

    def test_absolute_references(self) -> None:
        assert _value("=$A$1*2", {"S": {"A1": 4}}) == 8

    def test_numeric_text_in_a_reference_is_a_text_operand(self) -> None:
        result = _eval("=A1+1", {"S": {"A1": "5"}})
        assert result.value is None and "text operand" in (result.warning or "")


class TestEvaluatorReferences:
    def test_same_sheet_reference(self) -> None:
        assert _value("=A1+A2", {"S": {"A1": 3, "A2": 4}}) == 7

    def test_cross_sheet_reference(self) -> None:
        sheets = {"S": {}, "Data": {"B2": 12}}
        assert _value("=Data!B2*2", sheets) == 24

    def test_cross_sheet_quoted_name_with_space(self) -> None:
        sheets = {"S": {}, "Plant Data": {"B2": 12}}
        assert _value("='Plant Data'!B2+1", sheets) == 13

    def test_cross_sheet_name_with_hyphen_needs_quotes_and_resolves(self) -> None:
        sheets = {"S": {}, "Form-Sb": {"C3": 9}}
        assert _value("='Form-Sb'!C3", sheets) == 9

    def test_cross_sheet_range(self) -> None:
        sheets = {"S": {}, "D": {"A1": 1, "A2": 2}}
        assert _value("=SUM(D!A1:D!A2)", sheets) == 3
        assert _value("=SUM(D!A1:A2)", sheets) == 3

    def test_sheet_names_match_case_insensitively(self) -> None:
        assert _value("=data!A1", {"S": {}, "Data": {"A1": 2}}) == 2

    def test_columns_beyond_z(self) -> None:
        assert _value("=AB1+XFD1", {"S": {"AB1": 1, "XFD1": 2}}) == 3

    def test_formula_cell_referencing_formula_cell(self) -> None:
        sheets = {"S": {"A1": 2, "B1": "=A1*3", "C1": "=B1+1"}}
        ev = _evaluator(sheets)
        result = ev.evaluate_cell("S", 1, 3)
        assert result.value == 7 and result.evaluated and result.warning is None

    def test_cached_value_of_a_referenced_cell_wins(self) -> None:
        sh = wbmod.Sheet(name="S")
        sh.cells[(1, 1)] = wbmod.Cell("S", 1, 1, 100, "=1+1")  # cache says 100
        sh.cells[(1, 2)] = wbmod.Cell("S", 1, 2, None, "=A1+1")
        ev = FormulaEvaluator(Workbook(sheets=[sh]))
        assert ev.evaluate_cell("S", 1, 2).value == 101


class TestEvaluateCell:
    def test_plain_number_is_read_as_is(self) -> None:
        result = _evaluator({"S": {"A1": 12.5}}).evaluate_cell("S", 1, 1)
        assert result.value == Decimal("12.5") and not result.evaluated and result.warning is None

    def test_cached_value_wins_over_formula(self) -> None:
        sh = wbmod.Sheet(name="S")
        sh.cells[(1, 1)] = wbmod.Cell("S", 1, 1, 42, "=1+1")
        ev = FormulaEvaluator(Workbook(sheets=[sh]))
        cached = ev.evaluate_cell("S", 1, 1)
        assert cached.value == 42 and not cached.evaluated and cached.formula == "=1+1"
        forced = ev.evaluate_cell("S", 1, 1, use_cache=False)
        assert forced.value == 2 and forced.evaluated

    def test_formula_without_cache_is_evaluated(self) -> None:
        result = _evaluator({"S": {"A1": 4, "B1": "=A1*A1"}}).evaluate_cell("S", 1, 2)
        assert result.value == 16 and result.evaluated and result.formula == "=A1*A1"

    def test_integral_results_have_no_exponent_form(self) -> None:
        result = _eval("=1000*1000*1000")
        assert result.value == Decimal(10**9)
        assert str(result.value) == "1000000000"

    def test_negative_zero_is_zero(self) -> None:
        result = _eval("=-0")
        assert result.value == 0 and str(result.value) == "0"

    def test_float_cached_value_is_exact(self) -> None:
        assert _evaluator({"S": {"A1": 0.1}}).evaluate_cell("S", 1, 1).value == Decimal("0.1")

    def test_text_cell_has_no_numeric_value(self) -> None:
        result = _evaluator({"S": {"A1": "hello"}}).evaluate_cell("S", 1, 1)
        assert result.value is None and result.warning is not None and "S!A1" in result.warning

    def test_missing_cell_and_missing_sheet(self) -> None:
        ev = _evaluator({"S": {"A1": 1}})
        empty = ev.evaluate_cell("S", 9, 9)
        assert empty.value is None and "S!I9" in (empty.warning or "")
        nosheet = ev.evaluate_cell("Nope", 1, 1)
        assert nosheet.value is None and "sheet not found" in (nosheet.warning or "")


class TestEvaluatorFailures:
    """Requirement 6.8: no value, and a warning that names the cell."""

    def _fail(
        self, formula: str, sheets: dict[str, dict[str, Any]] | None = None
    ) -> wbmod.EvalResult:
        sheets = sheets or {"S": {}}
        ev = _evaluator(sheets)
        result = ev.evaluate_formula(formula, next(iter(sheets)), 3, 2)
        assert result.value is None
        assert result.warning is not None
        assert "S!B3" in result.warning
        return result

    @pytest.mark.parametrize(
        "formula", ["=VLOOKUP(1,A1:B2,2,0)", "=IF(1,2,3)", "=AVERAGE(1,2)", "=INDIRECT(\"A1\")"]
    )
    def test_unsupported_function(self, formula: str) -> None:
        result = self._fail(formula)
        assert "unsupported function" in result.warning  # type: ignore[operator]

    def test_unresolved_sheet(self) -> None:
        result = self._fail("=Missing!A1+1")
        assert "not found" in result.warning  # type: ignore[operator]

    def test_unresolved_name(self) -> None:
        result = self._fail("=Total_Coal*2")
        assert "unresolved" in result.warning  # type: ignore[operator]

    def test_text_operand(self) -> None:
        assert "text operand" in self._fail('="abc"+1').warning  # type: ignore[operator]
        assert "text operand" in self._fail("=A1+1", {"S": {"A1": "x"}}).warning  # type: ignore[operator]

    def test_division_by_zero(self) -> None:
        assert "division by zero" in self._fail("=1/0").warning  # type: ignore[operator]
        assert "division by zero" in self._fail("=1/(2-2)").warning  # type: ignore[operator]
        assert "division by zero" in self._fail("=0^-1").warning  # type: ignore[operator]

    def test_invalid_power_cases(self) -> None:
        assert self._fail("=0^0").value is None
        assert self._fail("=(-8)^0.5").value is None

    def test_range_outside_a_function(self) -> None:
        assert "range" in self._fail("=A1:A3+1").warning  # type: ignore[operator]

    def test_range_across_sheets(self) -> None:
        sheets = {"S": {}, "D": {}}
        assert self._fail("=SUM(S!A1:D!A2)", sheets).value is None

    @pytest.mark.parametrize(
        "formula",
        ["=", "=1+", "=(1+2", "=1+2)", "=SUM(1,)", "=1 2", "=SUM(1;2)", "=ROUND(1)", "=ABS()", "=ABS(1,2)", "=1+#REF!", "=SUM()"],
    )
    def test_malformed_formulas(self, formula: str) -> None:
        self._fail(formula)

    def test_cycle(self) -> None:
        sheets = {"S": {"A1": "=B1+1", "B1": "=A1+1"}}
        result = _evaluator(sheets).evaluate_cell("S", 1, 1)
        assert result.value is None
        assert "circular reference" in (result.warning or "")
        assert "S!A1" in (result.warning or "")

    def test_self_reference(self) -> None:
        result = _evaluator({"S": {"A1": "=A1+1"}}).evaluate_cell("S", 1, 1)
        assert result.value is None and "circular" in (result.warning or "")

    def test_error_inside_a_referenced_cell_names_both_cells(self) -> None:
        sheets = {"S": {"A1": "=1/0", "B1": "=A1+1"}}
        result = _evaluator(sheets).evaluate_cell("S", 1, 2)
        assert result.value is None
        assert "S!B1" in (result.warning or "") and "S!A1" in (result.warning or "")

    def test_nesting_over_100_levels_is_rejected(self) -> None:
        deep = "=" + "(" * 101 + "1" + ")" * 101
        result = self._fail(deep)
        assert "nesting" in result.warning  # type: ignore[operator]

    def test_nesting_of_100_levels_is_accepted(self) -> None:
        assert _value("=" + "(" * 100 + "1" + ")" * 100) == 1

    def test_function_nesting_over_100_levels_is_rejected(self) -> None:
        deep = "=" + "ABS(" * 101 + "1" + ")" * 101
        assert "nesting" in self._fail(deep).warning  # type: ignore[operator]

    def test_unary_chain_over_100_levels_is_rejected(self) -> None:
        assert "nesting" in self._fail("=" + "-" * 101 + "1").warning  # type: ignore[operator]

    def test_dependency_chain_over_100_levels_is_rejected(self) -> None:
        cells: dict[str, Any] = {"A1": 1}
        for i in range(2, 130):
            cells[f"A{i}"] = f"=A{i - 1}+1"
        result = _evaluator({"S": cells}).evaluate_cell("S", 129, 1)
        assert result.value is None and "levels deep" in (result.warning or "")

    def test_long_flat_sum_does_not_overflow_the_stack(self) -> None:
        formula = "=" + "+".join(["1"] * 5000)
        assert _value(formula) == 5000

    def test_overlong_formula_is_rejected(self) -> None:
        result = self._fail("=" + "1+" * 20000 + "1")
        assert "too long" in result.warning  # type: ignore[operator]

    @pytest.mark.parametrize("formula", ["=9^9^9", "=10^999999^2"])
    def test_overflow_gives_no_value(self, formula: str) -> None:
        # Either rejected as an arithmetic error or evaluated, but never raises.
        result = _eval(formula)
        assert result.value is None or isinstance(result.value, Decimal)

    def test_a_failed_evaluation_does_not_poison_the_next_one(self) -> None:
        ev = _evaluator({"S": {"A1": "=1/0", "B1": 2}})
        assert ev.evaluate_cell("S", 1, 1).value is None
        assert ev.evaluate_formula("=B1*3", "S").value == 6

    def test_warning_names_cell_for_unsupported_function_in_a_loaded_workbook(self) -> None:
        def build(ws: Any, wb: Any) -> None:
            ws.title = "Form-Sb"
            ws["A1"] = 1
            ws["C4"] = "=VLOOKUP(A1,A1:B2,2,0)"

        wb = load_workbook_bytes(_xlsx(build), "xlsx")
        result = FormulaEvaluator(wb).evaluate_cell("Form-Sb", 4, 3)
        assert result.value is None and "Form-Sb!C4" in (result.warning or "")


class TestEvaluatorOnLoadedWorkbook:
    def test_evaluates_formulas_written_by_openpyxl(self) -> None:
        def build(ws: Any, wb: Any) -> None:
            ws.title = "Main"
            ws["A1"] = 1000
            ws["A2"] = 2500
            ws["B1"] = "=SUM(A1:A2)"
            ws["B2"] = "=Other!A1*2+B1"
            wb.create_sheet("Other")["A1"] = 10

        ev = FormulaEvaluator(load_workbook_bytes(_xlsx(build), "xlsx"))
        assert ev.evaluate_cell("Main", 1, 2).value == 3500
        assert ev.evaluate_cell("Main", 2, 2).value == 3520

    def test_date_cell_reads_as_an_excel_serial(self) -> None:
        def build(ws: Any, wb: Any) -> None:
            ws["A1"] = datetime(2025, 4, 1)
            ws["B1"] = "=A1+1"

        ev = FormulaEvaluator(load_workbook_bytes(_xlsx(build), "xlsx"))
        assert ev.evaluate_cell("Sheet", 1, 2).value == Decimal(45749)


# ---------------------------------------------------------------------------
# No dynamic code execution (Requirement 6.9)
# ---------------------------------------------------------------------------

_FORBIDDEN = {"eval", "exec", "compile", "__import__"}


@pytest.fixture(scope="module")
def tree() -> ast.AST:
    return ast.parse(Path(wbmod.__file__).read_text(encoding="utf-8"))


class TestNoDynamicExecution:
    def test_no_forbidden_names_are_referenced(self, tree: ast.AST) -> None:
        hits = [
            (n.lineno, n.id)
            for n in ast.walk(tree)
            if isinstance(n, ast.Name) and n.id in _FORBIDDEN
        ]
        assert hits == []

    def test_no_forbidden_attribute_calls(self, tree: ast.AST) -> None:
        # ``builtins.eval(...)`` or ``module.exec(...)``. ``re.compile`` is not dynamic code,
        # so only receivers other than ``re`` are checked.
        hits = [
            (n.lineno, n.attr)
            for n in ast.walk(tree)
            if isinstance(n, ast.Attribute)
            and n.attr in _FORBIDDEN
            and not (isinstance(n.value, ast.Name) and n.value.id == "re")
        ]
        assert hits == []

    def test_no_forbidden_names_in_string_dispatch(self, tree: ast.AST) -> None:
        # ``getattr(builtins, "eval")`` style access.
        hits = [
            n.value
            for n in ast.walk(tree)
            if isinstance(n, ast.Constant) and isinstance(n.value, str) and n.value in _FORBIDDEN
        ]
        assert hits == []

    def test_no_dynamic_import_machinery(self, tree: ast.AST) -> None:
        modules = {
            alias.name.split(".")[0]
            for n in ast.walk(tree)
            if isinstance(n, ast.Import)
            for alias in n.names
        } | {
            (n.module or "").split(".")[0] for n in ast.walk(tree) if isinstance(n, ast.ImportFrom)
        }
        assert not modules & {"builtins", "importlib", "ast", "code", "codeop", "subprocess", "os"}

    def test_formula_text_is_never_run_as_code(self) -> None:
        payload = "__import__('os').system('echo hi')"
        for formula in (f"={payload}", f'="{payload}"', "=().__class__"):
            result = _eval(formula)
            assert result.value is None and result.warning is not None


# ---------------------------------------------------------------------------
# Calendar template months (supporting helper in the module)
# ---------------------------------------------------------------------------


class TestTemplateMonths:
    def test_twelve_months_april_first(self) -> None:
        months = template_months("FY2025-26")
        assert months[0] == "2025-04" and months[8] == "2025-12"
        assert months[9] == "2026-01" and months[-1] == "2026-03"
        assert len(months) == 12

    def test_bad_label_raises(self) -> None:
        with pytest.raises(ValueError):
            template_months("not a year")
