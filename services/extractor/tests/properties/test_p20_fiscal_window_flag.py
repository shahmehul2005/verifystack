"""Property 20: Fiscal-year window flag.

For any date and any FY label, a Reading dated inside the window has no
``outside_fiscal_year`` reason, and a Reading dated outside it has ``needs_review`` set (the
``outside_fiscal_year`` review reason) and a warning that contains the date.

Tables are built with openpyxl, read back through ``load_workbook_bytes``, ``detect_tables``
and ``parse_tables``. The expected side is computed from the generated date and the FY start
year with plain date comparisons (1 April to 31 March), not from ``FiscalWindow``.

**Validates: Requirements 7.9**
"""

from __future__ import annotations

import io
from datetime import date, datetime, timedelta
from typing import Any

import openpyxl
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from services.extractor.dates import parse_fy_label
from services.extractor.tabular import TabularContext, detect_tables, parse_tables
from services.extractor.workbook import load_workbook_bytes

from ..factories import fy_labels

SETTINGS = settings(
    max_examples=80,
    deadline=None,
    suppress_health_check=[HealthCheck.too_slow, HealthCheck.data_too_large],
)

STREAMS = ("Clinker Production (t)", "Coal Quantity (t)")
REASON = "outside_fiscal_year"


def _in_window(d: date, start_year: int) -> bool:
    return date(start_year, 4, 1) <= d <= date(start_year + 1, 3, 31)


def _xlsx(rows: list[list[Any]]) -> bytes:
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Log"
    for row in rows:
        ws.append(row)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


@st.composite
def case(draw: st.DrawFn) -> tuple[int, str, list[date]]:
    """``(start_year, label, distinct dates)`` with dates on both sides of the window edges."""
    start, label = draw(fy_labels())
    lo = date(start, 4, 1) - timedelta(days=400)
    hi = date(start + 1, 3, 31) + timedelta(days=400)
    edges = [
        date(start, 4, 1),
        date(start + 1, 3, 31),
        date(start, 3, 31),
        date(start + 1, 4, 1),
    ]
    dates = draw(
        st.lists(
            st.one_of(st.dates(min_value=lo, max_value=hi), st.sampled_from(edges)),
            min_size=1,
            max_size=6,
            unique=True,
        )
    )
    # All first-of-month dates read as months; keep them daily with one mid-month date.
    if all(d.day == 1 for d in dates):
        dates.append(date(start, 10, 15))
    return start, label, dates


@SETTINGS
@given(case())
def test_window_flag_and_warning(c: tuple[int, str, list[date]]) -> None:
    start, label, dates = c
    ctx = TabularContext(parse_fy_label(label))
    rows: list[list[Any]] = [["Date", *STREAMS]]
    for i, d in enumerate(dates):
        rows.append([datetime(d.year, d.month, d.day), 100.0 + i, 200.0 + i])
    wb = load_workbook_bytes(_xlsx(rows), "xlsx")
    shapes = [s for sheet in wb.sheets for s in detect_tables(sheet)]
    result = parse_tables(wb, shapes, ctx)

    items = [*result.mapped, *result.unmapped]
    cells = [cell for item in items for cell in item.cells]
    assert len(cells) == len(dates) * len(STREAMS)

    expected_outside = {d for d in dates if not _in_window(d, start)}
    for cell in cells:
        assert cell.period is not None and cell.period.date is not None
        d = cell.period.date
        assert d in dates
        if _in_window(d, start):
            assert REASON not in cell.review_reasons
        else:
            assert REASON in cell.review_reasons

    warnings = [w for w in result.warnings if w.code == REASON]
    # The message also names the window bounds, so match the date in its "Period <date>" slot.
    for d in expected_outside:
        assert any(f"Period {d.isoformat()} " in w.message for w in warnings), d
    for d in set(dates) - expected_outside:
        assert not any(f"Period {d.isoformat()} " in w.message for w in warnings), d
    assert len(warnings) == len(expected_outside)
