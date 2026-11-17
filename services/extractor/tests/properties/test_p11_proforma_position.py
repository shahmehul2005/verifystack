"""Property 11: Pro forma parsing is position independent.

For any pro forma grid shifted by any number of inserted blank rows and columns, and with
any number of blank or text cells between a label and its value, the parser returns the
same values with the shifted cell addresses.

**Validates: Requirements 6.1, 6.2**

Feature: industrial-extractor, Property 11: Pro forma parsing is position independent

Each example builds one pro forma from a random subset of labels and values. The same
labels and values are also written at the top left with no gaps (the baseline). The shifted
workbook must give the baseline readings, and each reading must point at the cell where
the value was actually written.
"""

from __future__ import annotations

import io
from dataclasses import dataclass
from typing import Any

import openpyxl
from hypothesis import given, settings
from hypothesis import strategies as st

from services.extractor.proforma import ProformaResult, parse_proforma
from services.extractor.workbook import a1, load_workbook_bytes

# (label as written, stream key it must map to). Every label here maps to exactly one
# target, and a mix of labels with and without a unit in parentheses is kept on purpose.
POOL: tuple[tuple[str, str], ...] = (
    ("Clinker Production (t)", "clinker_production"),
    ("OPC Produced (t)", "opc_production"),
    ("PPC Produced", "ppc_production"),
    ("Imported Coal GCV (kcal/kg)", "imported_coal_gcv"),
    ("GCV of Coal (kcal/kg)", "coal_gcv"),
    ("Petcoke consumed (t)", "petcoke_quantity"),
    ("Imported from Grid (kWh)", "grid_electricity"),
    ("Exported to Grid", "power_export"),
    ("CPP power generation (kWh)", "cpp_generation"),
    ("WHRS generation (kWh)", "whrs_generation"),
)

# Text that can sit between a label and its value. None of it is numeric or a label.
FILLER_TEXT = ("t", "NA", "Remarks", "Unit", "see note")

SHEET = "Form-Sb"


@dataclass(frozen=True)
class Placement:
    """Where one entry goes: filler cells after the label, then the value."""

    pool_index: int
    value: float
    filler: tuple[str | None, ...]  # None is a blank cell, a string is a text cell
    gap_after: int  # blank rows left below this entry


@st.composite
def placements(draw: st.DrawFn) -> list[Placement]:
    indexes = draw(
        st.lists(st.integers(0, len(POOL) - 1), min_size=1, max_size=len(POOL), unique=True)
    )
    out: list[Placement] = []
    for i in indexes:
        # Quarters are exact in binary, so the value read back equals the value written.
        value = draw(st.integers(1, 40_000_000)) / 4
        filler = tuple(
            draw(st.lists(st.sampled_from([None, *FILLER_TEXT]), min_size=0, max_size=4))
        )
        out.append(Placement(i, value, filler, draw(st.integers(0, 3))))
    return out


def build(
    entries: list[Placement],
    *,
    row_offset: int = 0,
    col_offset: int = 0,
    with_gaps: bool = True,
    title: str | None = None,
) -> tuple[bytes, dict[str, tuple[int, int]]]:
    """Write the pro forma and return its bytes and the value cell of each stream."""
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = SHEET
    row = 1 + row_offset
    col0 = 1 + col_offset
    if title:
        ws.cell(row=row, column=col0, value=title)
        row += 2
    value_cells: dict[str, tuple[int, int]] = {}
    for entry in entries:
        label, stream = POOL[entry.pool_index]
        ws.cell(row=row, column=col0, value=label)
        filler = entry.filler if with_gaps else ()
        for j, text in enumerate(filler, start=1):
            if text is not None:
                ws.cell(row=row, column=col0 + j, value=text)
        value_col = col0 + len(filler) + 1
        ws.cell(row=row, column=value_col, value=entry.value)
        value_cells[stream] = (row, value_col)
        row += 1 + (entry.gap_after if with_gaps else 0)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue(), value_cells


def parse(data: bytes) -> ProformaResult:
    wb = load_workbook_bytes(data, "xlsx")
    return parse_proforma(wb, wb.sheets)


def values_only(result: ProformaResult) -> dict[str, tuple[Any, ...]]:
    """Everything a reading says except where it came from."""
    return {
        r.stream_key.value: (
            r.label,
            r.value,
            r.value_as_stated,
            r.unit_as_stated,
            r.normalized_value,
            r.normalized_unit,
            r.unit_assumed,
            r.verified,
            r.needs_review,
            tuple(r.review_reasons),
            r.derived,
        )
        for r in result.readings
    }


@settings(max_examples=100, deadline=None)
@given(
    entries=placements(),
    row_offset=st.integers(0, 40),
    col_offset=st.integers(0, 40),
    title=st.one_of(st.none(), st.just("Form-Sb, Old DC in PAT-2")),
)
def test_shifting_and_padding_the_grid_keeps_values_and_moves_addresses(
    entries: list[Placement], row_offset: int, col_offset: int, title: str | None
) -> None:
    base_data, _ = build(entries, with_gaps=False)
    base = parse(base_data)

    data, value_cells = build(
        entries, row_offset=row_offset, col_offset=col_offset, title=title
    )
    got = parse(data)

    # Same readings, same values, same flags.
    assert values_only(got) == values_only(base)
    assert set(values_only(got)) == set(value_cells)
    assert [w.code for w in got.warnings] == [w.code for w in base.warnings] == []
    assert got.skipped == []

    # The value is the number that was written, read from the cell it was written in.
    for entry in entries:
        _, stream = POOL[entry.pool_index]
        reading = next(r for r in got.readings if r.stream_key.value == stream)
        row, col = value_cells[stream]
        assert reading.value == entry.value
        assert reading.provenance.sheet == SHEET
        assert reading.provenance.cell == a1(row, col)
        assert SHEET in reading.raw_id and a1(row, col) in reading.raw_id
        assert reading.provenance.page is None


def test_a_value_after_blank_and_text_cells_is_found_at_its_real_address() -> None:
    """One concrete case: two text cells and two blanks sit between label and value."""
    entries = [Placement(0, 150000.0, ("t", None, "NA", None), 0)]
    data, cells = build(entries, row_offset=7, col_offset=3)
    reading = parse(data).readings[0]
    assert cells["clinker_production"] == (8, 9)
    assert reading.value == 150000
    assert reading.provenance.cell == "I8"
