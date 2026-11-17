"""Property 1: Template round trip.

Feature: industrial-extractor, Property 1: Template round trip.

For any valid FY label and any subset of (month, stream, value) cells filled into the
generated template, parsing the filled workbook yields exactly those readings with the
same values, streams and months, and rows with an empty Value yield none.

**Validates: Requirements 1.4, 7.1**
"""

from __future__ import annotations

import asyncio
import io
from decimal import Decimal

import openpyxl
from hypothesis import given, settings
from hypothesis import strategies as st
from pydantic_ai.models import Model

from services.extractor.config import get_settings
from services.extractor.dates import parse_fy_label
from services.extractor.models import BEEPATSectorStream, CalendarParams
from services.extractor.pipeline import (
    PipelineDeps,
    Upload,
    classify_sheets,
    extract_calendar,
    make_contexts,
)
from services.extractor.tabular import parse_tables
from services.extractor.tests.factories import decimals, fy_labels
from services.extractor.units import STANDARD_UNIT
from services.extractor.workbook import (
    CALENDAR_SHEET,
    build_calendar_template,
    load_workbook_bytes,
    template_months,
)

STREAMS = list(BEEPATSectorStream)

Cell = tuple[int, BEEPATSectorStream]  # (month index 0..11, stream)


class NoModelProvider:
    """Fails the test if the pipeline asks for a model: every template label maps by rule."""

    def get(self) -> Model:
        raise AssertionError("a model was requested, but a template needs none")


@st.composite
def filled_cells(draw: st.DrawFn) -> dict[Cell, Decimal]:
    """Any subset of the 12 x 25 template cells, each with a positive value."""
    keys = st.tuples(st.integers(min_value=0, max_value=11), st.sampled_from(STREAMS))
    return draw(
        st.dictionaries(keys, decimals(max_int_digits=9, max_places=3), min_size=0, max_size=40)
    )


def fill_template(data: bytes, months: list[str], cells: dict[Cell, Decimal]) -> bytes:
    """Write ``cells`` into the Value column of the Calendar sheet and leave the rest empty."""
    wb = openpyxl.load_workbook(io.BytesIO(data))
    ws = wb[CALENDAR_SHEET]
    wanted = {(months[m], stream.value): value for (m, stream), value in cells.items()}
    seen = 0
    for row in range(2, ws.max_row + 1):
        key = (ws.cell(row=row, column=1).value, ws.cell(row=row, column=2).value)
        if key in wanted:
            ws.cell(row=row, column=3, value=float(wanted[key]))
            seen += 1
    assert seen == len(wanted), "every wanted cell must exist as a template row"
    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()


def expected_triples(
    months: list[str], cells: dict[Cell, Decimal]
) -> set[tuple[str, str, float]]:
    return {(stream.value, months[m], float(value)) for (m, stream), value in cells.items()}


@settings(max_examples=40, deadline=None)
@given(fy=fy_labels(), cells=filled_cells())
def test_filled_template_parses_to_exactly_the_filled_cells(
    fy: tuple[int, str], cells: dict[Cell, Decimal]
) -> None:
    start, label = fy
    months = template_months(label)
    assert months[0] == f"{start:04d}-04" and months[-1] == f"{start + 1:04d}-03"

    filled = fill_template(build_calendar_template(label), months, cells)
    expected = expected_triples(months, cells)

    # Tabular_Parser level (Requirement 7.1): the Calendar sheet is a long-layout table.
    wb = load_workbook_bytes(filled, "xlsx")
    plan = classify_sheets(wb)
    assert [s.sheet for s in plan.tabular] == [CALENDAR_SHEET]
    _, tctx = make_contexts(wb, parse_fy_label(label))
    parsed = parse_tables(wb, plan.tabular, tctx)
    assert parsed.unmapped == []
    assert parsed.skipped == []
    assert not [w for w in parsed.warnings if w.code == "outside_fiscal_year"]
    got_cells = [
        (m.stream.value, c.period.month_key, float(c.raw))
        for m in parsed.mapped
        for c in m.cells
        if c.period is not None
    ]
    assert len(got_cells) == len(expected)
    assert set(got_cells) == expected
    assert all(c.period is not None and c.period.kind == "monthly" for m in parsed.mapped for c in m.cells)

    # Pipeline level (Requirement 1.4): the same readings come out of the whole flow.
    deps = PipelineDeps(get_settings(), NoModelProvider())
    response = asyncio.run(
        extract_calendar(
            Upload("template.xlsx", filled), CalendarParams(compliance_year=label), deps
        )
    )
    got = [(r.stream_key.value, r.period.month_key, r.value) for r in response.readings]
    assert len(got) == len(expected)
    assert set(got) == expected
    assert response.run.model_calls == 0
    for r in response.readings:
        assert r.period.kind == "monthly"
        assert r.normalized_unit == STANDARD_UNIT[r.stream_key]


@settings(max_examples=20, deadline=None)
@given(fy=fy_labels())
def test_blank_template_yields_no_readings(fy: tuple[int, str]) -> None:
    _, label = fy
    data = build_calendar_template(label)

    wb = load_workbook_bytes(data, "xlsx")
    plan = classify_sheets(wb)
    _, tctx = make_contexts(wb, parse_fy_label(label))
    parsed = parse_tables(wb, plan.tabular, tctx)
    assert parsed.mapped == []
    assert parsed.unmapped == []


def test_month_that_looks_like_a_bare_fy_label_stays_a_month() -> None:
    """Regression: ``2003-04`` is both April 2003 and the bare label of FY2003-04.

    The first counterexample Hypothesis found read the April cell of FY2003-04 as annual.
    """
    cells = {(0, BEEPATSectorStream.EQUIVALENT_PRODUCT): Decimal(1)}
    months = template_months("FY2003-04")
    assert months[0] == "2003-04"
    filled = fill_template(build_calendar_template("FY2003-04"), months, cells)

    wb = load_workbook_bytes(filled, "xlsx")
    _, tctx = make_contexts(wb, parse_fy_label("FY2003-04"))
    parsed = parse_tables(wb, classify_sheets(wb).tabular, tctx)

    periods = [(c.period.kind, c.period.month_key) for m in parsed.mapped for c in m.cells if c.period]
    assert periods == [("monthly", "2003-04")]
