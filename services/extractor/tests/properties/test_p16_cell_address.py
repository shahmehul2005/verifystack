"""Property 16: Cell address round trip.

For any row from 1 to 1,048,576 and column from 1 to 16,384, ``parse_a1(a1(row, col))``
returns the same row and column, and every Raw_Id and provenance cell for a cell beyond
column Z uses the multi-letter column name.

**Validates: Requirements 6.12**

Feature: industrial-extractor, Property 16: Cell address round trip

Three groups of checks. The first covers ``a1`` and ``parse_a1`` over the whole grid. The
second covers ``make_raw_id`` and ``split_raw_id``, including sheet names that hold ``!``.
The third parses a real pro forma whose label and value sit beyond column Z and checks the
provenance cell and the Raw_Id of the Reading.
"""

from __future__ import annotations

import io
import re

import openpyxl
import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from services.extractor.proforma import parse_proforma
from services.extractor.workbook import (
    MAX_COL,
    MAX_ROW,
    a1,
    load_workbook_bytes,
    make_raw_id,
    parse_a1,
    split_raw_id,
)

rows = st.integers(min_value=1, max_value=MAX_ROW)
cols = st.integers(min_value=1, max_value=MAX_COL)
beyond_z = st.integers(min_value=27, max_value=MAX_COL)

# Sheet names may hold spaces, hyphens and "!" but never the characters Excel forbids.
sheet_names = st.text(
    alphabet=st.characters(
        whitelist_categories=("Lu", "Ll", "Nd"), whitelist_characters=" -_!."
    ),
    min_size=1,
    max_size=20,
).filter(lambda s: s.strip() == s and s != "")

SHEET = "Form-Sb"


def letters_of(col: int) -> str:
    """Independent column name: the letters of ``a1`` with the row digits removed."""
    return re.sub(r"\d+$", "", a1(1, col))


@settings(max_examples=200, deadline=None)
@given(row=rows, col=cols)
def test_parse_a1_inverts_a1_over_the_whole_grid(row: int, col: int) -> None:
    ref = a1(row, col)
    assert parse_a1(ref) == (row, col)
    assert re.fullmatch(r"[A-Z]{1,3}[0-9]+", ref)
    # Absolute markers and lower case give the same cell.
    assert parse_a1(f"${letters_of(col)}${row}") == (row, col)
    assert parse_a1(ref.lower()) == (row, col)


@settings(max_examples=200, deadline=None)
@given(row=rows, col=cols)
def test_a1_is_injective_and_the_column_length_follows_base_26(row: int, col: int) -> None:
    ref = a1(row, col)
    letters = ref[: len(ref) - len(str(row))]
    expected_len = 1 if col <= 26 else 2 if col <= 702 else 3
    assert len(letters) == expected_len
    # Next column gives a different address in the same row.
    if col < MAX_COL:
        assert a1(row, col + 1) != ref


@settings(max_examples=100, deadline=None)
@given(row=rows, col=beyond_z)
def test_a_column_beyond_z_has_a_multi_letter_name(row: int, col: int) -> None:
    ref = a1(row, col)
    letters = letters_of(col)
    assert len(letters) >= 2
    assert ref == f"{letters}{row}"
    raw_id = make_raw_id(SHEET, row, col)
    assert raw_id == f"{SHEET}!{letters}{row}"


@settings(max_examples=200, deadline=None)
@given(sheet=sheet_names, row=rows, col=cols)
def test_raw_id_splits_back_to_sheet_and_cell_even_with_bang_in_the_name(
    sheet: str, row: int, col: int
) -> None:
    raw_id = make_raw_id(sheet, row, col)
    got_sheet, ref = split_raw_id(raw_id)
    assert got_sheet == sheet
    assert ref == a1(row, col)
    assert parse_a1(ref) == (row, col)


def test_known_boundaries() -> None:
    assert a1(1, 1) == "A1"
    assert a1(1, 26) == "Z1"
    assert a1(1, 27) == "AA1"
    assert a1(1, 28) == "AB1"
    assert a1(1, 52) == "AZ1"
    assert a1(1, 53) == "BA1"
    assert a1(1, 702) == "ZZ1"
    assert a1(1, 703) == "AAA1"
    assert a1(MAX_ROW, MAX_COL) == f"XFD{MAX_ROW}"
    assert parse_a1("XFD1048576") == (MAX_ROW, MAX_COL)


@pytest.mark.parametrize(
    ("row", "col"), [(0, 1), (1, 0), (MAX_ROW + 1, 1), (1, MAX_COL + 1), (-1, 5)]
)
def test_a1_rejects_out_of_range_positions(row: int, col: int) -> None:
    with pytest.raises(ValueError):
        a1(row, col)


@pytest.mark.parametrize("ref", ["", "A", "1", "A0", "XFE1", "A1048577", "A-1", "1A", "AAAA1"])
def test_parse_a1_rejects_invalid_references(ref: str) -> None:
    with pytest.raises(ValueError):
        parse_a1(ref)


# ---------------------------------------------------------------------------
# A real pro forma with the label and value beyond column Z
# ---------------------------------------------------------------------------


def _wide_proforma(label_col: int, label_row: int, value: float) -> bytes:
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = SHEET
    ws.cell(row=label_row, column=label_col, value="Clinker Production (t)")
    ws.cell(row=label_row, column=label_col + 1, value=value)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


@settings(max_examples=30, deadline=None)
@given(
    label_col=st.integers(min_value=26, max_value=MAX_COL - 1),
    label_row=st.integers(min_value=1, max_value=5_000),
    quarters=st.integers(min_value=1, max_value=40_000_000),
)
def test_proforma_readings_beyond_column_z_carry_the_multi_letter_address(
    label_col: int, label_row: int, quarters: int
) -> None:
    value = quarters / 4  # exact in binary
    wb = load_workbook_bytes(_wide_proforma(label_col, label_row, value), "xlsx")
    result = parse_proforma(wb, wb.sheets)

    assert [r.stream_key.value for r in result.readings] == ["clinker_production"]
    reading = result.readings[0]
    value_col = label_col + 1
    expected = a1(label_row, value_col)

    assert reading.value == value
    assert reading.provenance.sheet == SHEET
    assert reading.provenance.cell == expected
    assert reading.provenance.page is None
    assert reading.raw_id == f"{SHEET}!{expected}"
    assert parse_a1(split_raw_id(reading.raw_id)[1]) == (label_row, value_col)
    # Column 27 and up has at least two letters, so the address is never a single letter.
    assert len(letters_of(value_col)) >= 2
    assert re.match(r"^[A-Z]{2,3}[0-9]+$", reading.provenance.cell)
