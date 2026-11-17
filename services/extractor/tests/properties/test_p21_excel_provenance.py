"""Property 21: Excel provenance points at the source cell.

For any Reading from a workbook, re-opening the workbook and reading the cell named by
``provenance.sheet`` and ``provenance.cell`` gives the stated value, ``page`` is null, and
``verified`` is true.

**Validates: Requirements 7.10, 10.3, 10.4**

Feature: industrial-extractor, Property 21: Excel provenance points at the source cell

Workbooks are built with the factories, run through ``extract_calendar`` (the three tabular
layouts) and ``parse_proforma`` (a pro forma moved by a row and column offset), then opened
again with openpyxl, which is independent of the extractor's own loader. Every label maps by
rule, so no model is needed.
"""

from __future__ import annotations

import asyncio
import io
from typing import Any

import openpyxl
from hypothesis import HealthCheck, assume, given, settings
from hypothesis import strategies as st
from pydantic_ai.models import Model

from services.extractor.config import get_settings
from services.extractor.models import CalendarParams, Reading
from services.extractor.pipeline import PipelineDeps, Upload, extract_calendar
from services.extractor.proforma import parse_proforma
from services.extractor.tests.factories import (
    long_table,
    periods_in_columns,
    periods_in_rows,
    proforma_workbook,
)
from services.extractor.workbook import load_workbook_bytes, parse_a1

SETTINGS = settings(
    max_examples=40,
    deadline=None,
    suppress_health_check=[HealthCheck.too_slow, HealthCheck.data_too_large],
)

FY = "FY2023-24"
MONTHS = ("Apr-2023", "May-2023", "Jun-2023", "Jul-2023", "Aug-2023", "Sep-2023")
LABELS = (
    "Clinker Production (t)",
    "Coal Quantity (t)",
    "Petcoke Quantity (t)",
    "OPC Production (t)",
)
LAYOUTS = ("long", "columns", "rows")

# Exact in binary, so a float read back equals the float written.
quarters = st.integers(min_value=1, max_value=40_000_000).map(lambda q: q / 4)


class NoModelProvider:
    def get(self) -> Model:
        raise AssertionError("a model was requested, but every label maps by rule")


@st.composite
def grids(draw: st.DrawFn) -> dict[tuple[str, str], float]:
    """``(label, month)`` to a value: a non-empty subset of the label by month grid."""
    keys = st.tuples(st.sampled_from(LABELS), st.sampled_from(MONTHS))
    return draw(st.dictionaries(keys, quarters, min_size=2, max_size=len(LABELS) * len(MONTHS)))


def build(layout: str, grid: dict[tuple[str, str], float], title: bool) -> bytes:
    heading = "Plant calendar FY2023-24" if title else None
    if layout == "long":
        records = [(m, label, v, "t") for (label, m), v in grid.items()]
        return long_table(records, title=heading)
    labels = sorted({label for label, _ in grid})
    months = sorted({m for _, m in grid}, key=MONTHS.index)
    if layout == "columns":
        # Periods across the columns needs at least two period columns to be a table.
        assume(len(months) >= 2)
        series = [(label, [grid.get((label, m)) for m in months]) for label in labels]
        return periods_in_columns(months, series, title=heading)
    # Periods down the rows needs at least two stream columns (see the factory docstring).
    assume(len(labels) >= 2)
    columns = [(label, [grid.get((label, m)) for m in months]) for label in labels]
    return periods_in_rows(months, columns, period_header="Month", title=heading)


def run_calendar(data: bytes) -> list[Reading]:
    deps = PipelineDeps(get_settings(), NoModelProvider())
    req = CalendarParams(compliance_year=FY)
    result = asyncio.run(extract_calendar(Upload("upload.xlsx", data), req, deps))
    return list(result.readings)


def assert_points_at_source(data: bytes, readings: list[Reading]) -> None:
    reopened = openpyxl.load_workbook(io.BytesIO(data), data_only=True)
    try:
        for r in readings:
            p = r.provenance
            assert r.source == "excel"
            assert r.verified is True
            assert p.page is None
            assert p.bbox is None
            assert p.sheet in reopened.sheetnames
            assert p.cell is not None
            parse_a1(p.cell)  # a valid A1 address
            assert r.raw_id == f"{p.sheet}!{p.cell}"
            stated: Any = reopened[p.sheet][p.cell].value
            assert isinstance(stated, (int, float)) and not isinstance(stated, bool)
            assert float(stated) == r.value
    finally:
        reopened.close()


@SETTINGS
@given(layout=st.sampled_from(LAYOUTS), grid=grids(), title=st.booleans())
def test_tabular_readings_point_at_the_source_cell(
    layout: str, grid: dict[tuple[str, str], float], title: bool
) -> None:
    data = build(layout, grid, title)
    readings = run_calendar(data)

    assert len(readings) == len(grid)
    assert_points_at_source(data, readings)
    # Each cell is read once: no two readings share a source cell.
    assert len({r.raw_id for r in readings}) == len(readings)
    # The multiset of values is exactly what was written.
    assert sorted(r.value for r in readings) == sorted(grid.values())


@SETTINGS
@given(
    clinker=quarters,
    gcv=st.integers(min_value=1, max_value=9000),
    row_offset=st.integers(min_value=0, max_value=40),
    col_offset=st.integers(min_value=0, max_value=60),
    gap_rows=st.integers(min_value=0, max_value=2),
    sheet=st.sampled_from(["Form-Sb", "Sheet1", "Old DC in PAT-2"]),
    title=st.booleans(),
)
def test_proforma_readings_point_at_the_source_cell(
    clinker: float,
    gcv: int,
    row_offset: int,
    col_offset: int,
    gap_rows: int,
    sheet: str,
    title: bool,
) -> None:
    rows = [("Clinker Production (t)", clinker), ("Imported Coal GCV (kcal/kg)", gcv)]
    data = proforma_workbook(
        rows,
        sheet=sheet,
        title="Form-Sb" if title else None,
        row_offset=row_offset,
        col_offset=col_offset,
        gap_rows=gap_rows,
    )
    wb = load_workbook_bytes(data, "xlsx")
    readings = parse_proforma(wb, wb.sheets).readings

    assert {r.stream_key.value for r in readings} == {"clinker_production", "imported_coal_gcv"}
    assert_points_at_source(data, readings)
    assert all(r.provenance.sheet == sheet for r in readings)
