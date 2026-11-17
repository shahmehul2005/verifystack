"""Property 12: Current-year column wins.

For any Baseline value and Current or Assessment value, in either column order and with
merged headers, the Reading equals the Current or Assessment value. When that cell is empty
the parser returns no reading for the row, and never falls back to the Baseline value.

The workbooks are built with openpyxl in memory and read back through
``load_workbook_bytes`` and ``parse_proforma``, so the property holds on the real loader
output, including merged ranges.

**Validates: Requirements 6.3**
"""

from __future__ import annotations

import io
from dataclasses import dataclass
from decimal import Decimal
from typing import Any

import openpyxl
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from services.extractor.proforma import ProformaResult, parse_proforma
from services.extractor.tests.factories import decimals
from services.extractor.workbook import load_workbook_bytes

SHEET = "Form-Sb"

# Labels that each match exactly one target and carry a unit equal to the stream standard
# unit, so the Reading value is the cell value.
LABELS: tuple[tuple[str, str], ...] = (
    ("Clinker Production (t)", "clinker_production"),
    ("OPC Production (t)", "opc_production"),
    ("PPC Production (t)", "ppc_production"),
    ("Imported Coal GCV (kcal/kg)", "imported_coal_gcv"),
    ("Petcoke GCV (kcal/kg)", "petcoke_gcv"),
    ("Imported from grid (kWh)", "grid_electricity"),
)

BASELINE_HEADERS = ("Baseline Year", "Baseline", "Base Year")
CURRENT_HEADERS = ("Current Year", "Current", "Assessment Year", "Assessment")


@dataclass(frozen=True)
class RowSpec:
    label: str
    stream: str
    baseline: Decimal
    current: Decimal
    current_empty: bool
    baseline_slot: int  # which column of the Baseline group holds the value
    current_slot: int  # which column of the Current group holds the value


@dataclass(frozen=True)
class Layout:
    rows: tuple[RowSpec, ...]
    current_first: bool
    baseline_header: str
    current_header: str
    baseline_width: int
    current_width: int
    merged: bool
    tall_header: bool  # header text merged down over a second header row
    row_offset: int
    col_offset: int
    gap_rows: int


@st.composite
def row_specs(draw: st.DrawFn, *, allow_empty: bool) -> tuple[RowSpec, ...]:
    chosen = draw(st.lists(st.sampled_from(LABELS), min_size=1, max_size=3, unique=True))
    out: list[RowSpec] = []
    for label, stream in chosen:
        current = draw(decimals())
        baseline = draw(decimals())
        if baseline == current:
            baseline += 1  # a wrong column choice must change the value
        out.append(
            RowSpec(
                label=label,
                stream=stream,
                baseline=baseline,
                current=current,
                current_empty=draw(st.booleans()) if allow_empty else False,
                baseline_slot=draw(st.integers(0, 1)),
                current_slot=draw(st.integers(0, 1)),
            )
        )
    return tuple(out)


@st.composite
def layouts(draw: st.DrawFn, *, allow_empty: bool) -> Layout:
    merged = draw(st.booleans())
    width = (lambda: draw(st.integers(1, 2))) if merged else (lambda: 1)
    return Layout(
        rows=draw(row_specs(allow_empty=allow_empty)),
        current_first=draw(st.booleans()),
        baseline_header=draw(st.sampled_from(BASELINE_HEADERS)),
        current_header=draw(st.sampled_from(CURRENT_HEADERS)),
        baseline_width=width(),
        current_width=width(),
        merged=merged,
        tall_header=merged and draw(st.booleans()),
        row_offset=draw(st.integers(0, 4)),
        col_offset=draw(st.integers(0, 3)),
        gap_rows=draw(st.integers(0, 2)),
    )


def build(layout: Layout) -> bytes:
    """Write the layout: labels in one column, then the two year column groups."""
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = SHEET
    label_col = 1 + layout.col_offset
    header_row = 1 + layout.row_offset

    groups = [
        ("baseline", layout.baseline_header, layout.baseline_width),
        ("current", layout.current_header, layout.current_width),
    ]
    if layout.current_first:
        groups.reverse()

    start: dict[str, int] = {}
    col = label_col + 1
    ws.cell(row=header_row, column=label_col, value="Particulars")
    for kind, text, width in groups:
        start[kind] = col
        ws.cell(row=header_row, column=col, value=text)
        if layout.merged and (width > 1 or layout.tall_header):
            ws.merge_cells(
                start_row=header_row,
                start_column=col,
                end_row=header_row + (1 if layout.tall_header else 0),
                end_column=col + width - 1,
            )
        col += width

    row = header_row + (2 if layout.tall_header else 1)
    for spec in layout.rows:
        ws.cell(row=row, column=label_col, value=spec.label)
        base_col = start["baseline"] + min(spec.baseline_slot, layout.baseline_width - 1)
        cur_col = start["current"] + min(spec.current_slot, layout.current_width - 1)
        ws.cell(row=row, column=base_col, value=float(spec.baseline))
        if not spec.current_empty:
            ws.cell(row=row, column=cur_col, value=float(spec.current))
        row += 1 + layout.gap_rows

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def parse(data: bytes) -> ProformaResult:
    wb = load_workbook_bytes(data, "xlsx")
    return parse_proforma(wb, wb.sheets)


def readings_by_stream(result: ProformaResult) -> dict[str, Any]:
    return {r.stream_key.value: r for r in result.readings}


PBT = settings(
    max_examples=60,
    deadline=None,
    suppress_health_check=[HealthCheck.too_slow, HealthCheck.data_too_large],
)


@PBT
@given(layout=layouts(allow_empty=False))
def test_reading_equals_the_current_year_value(layout: Layout) -> None:
    """Whatever the column order and header merging, the Current value is the Reading."""
    result = parse(build(layout))
    got = readings_by_stream(result)

    assert set(got) == {spec.stream for spec in layout.rows}
    for spec in layout.rows:
        reading = got[spec.stream]
        assert reading.value == float(spec.current)
        assert reading.normalized_value == float(spec.current)
        assert reading.value != float(spec.baseline)


@PBT
@given(layout=layouts(allow_empty=True))
def test_empty_current_cell_gives_no_reading_and_no_baseline_fallback(layout: Layout) -> None:
    """A row with an empty Current cell yields no Reading, even with a Baseline value."""
    result = parse(build(layout))
    got = readings_by_stream(result)

    for spec in layout.rows:
        if spec.current_empty:
            assert spec.stream not in got
        else:
            assert got[spec.stream].value == float(spec.current)

    # Nothing in the output carries a Baseline value from an empty-Current row.
    empty_baselines = {float(s.baseline) for s in layout.rows if s.current_empty}
    current_values = {float(s.current) for s in layout.rows}
    for reading in result.readings:
        if reading.value in empty_baselines:
            assert reading.value in current_values

    missing = [w for w in result.warnings if w.code == "current_value_missing"]
    assert len(missing) == sum(1 for s in layout.rows if s.current_empty)
