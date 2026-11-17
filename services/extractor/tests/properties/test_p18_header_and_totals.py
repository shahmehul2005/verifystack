"""Property 18: Header choice and total rows.

For any table preceded by decoy rows with fewer recognized labels, the chosen header is the
real one. For any table with rows or columns labelled ``Total``, ``Grand Total`` or
``Sub-total`` inserted at any position, no Reading comes from them and the other Readings are
unchanged.

The tables are built with openpyxl in memory and read back through ``load_workbook_bytes``,
``detect_tables`` and ``parse_tables``, so the property holds on the real loader output for
all three layouts. A reading is identified by ``(label, period)`` and its raw cell value, so
inserting a row or column (which moves cell addresses) does not count as a change.

**Validates: Requirements 7.4, 7.8**
"""

from __future__ import annotations

import io
from collections.abc import Sequence
from datetime import date, datetime, timedelta
from typing import Any

import openpyxl
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from services.extractor.dates import parse_fy_label
from services.extractor.tabular import (
    TabularContext,
    TabularResult,
    detect_tables,
    parse_tables,
)
from services.extractor.workbook import load_workbook_bytes

SETTINGS = settings(
    max_examples=60,
    deadline=None,
    suppress_health_check=[HealthCheck.too_slow, HealthCheck.data_too_large],
)
CTX = TabularContext(parse_fy_label("FY2023-24"))

# Labels the Rules_Mapper maps with the phrase rule, each with a unit in parentheses.
STREAM_LABELS = (
    "Clinker Production (t)",
    "Coal Quantity (t)",
    "Petcoke Quantity (t)",
    "OPC Production (t)",
)
MONTHS = tuple(f"{m}-23" for m in ("Apr", "May", "Jun", "Jul", "Aug", "Sep")) + (
    "Oct-23",
    "Nov-23",
    "Dec-23",
    "Jan-24",
    "Feb-24",
    "Mar-24",
)
TOTAL_LABELS = (
    "Total",
    "TOTAL",
    "total",
    "Grand Total",
    "GRAND TOTAL",
    "Sub-total",
    "Sub-Total",
    "Sub Total",
    "Subtotal",
    "Total:",
    " Total ",
)

# Cells that score nothing as a header, and cells that score one each.
UNRECOGNIZED = ("Prepared by", "Plant head", "Checked by", "Approved", "Page 1 of 2")
RECOGNIZED = ("Month", "Clinker Production (t)", "Unit", "Value", "Coal Quantity (t)")

# Larger than any generated data value, so a total cell is easy to tell from a reading.
SENTINEL = 10_000_000.0

Grid = list[list[Any]]
Expected = dict[tuple[str, str], float]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _xlsx(rows: Sequence[Sequence[Any]]) -> bytes:
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Data"
    for row in rows:
        ws.append(list(row))
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def _parse(rows: Sequence[Sequence[Any]]) -> tuple[list[Any], TabularResult]:
    wb = load_workbook_bytes(_xlsx(rows), "xlsx")
    shapes = [s for sheet in wb.sheets for s in detect_tables(sheet)]
    return shapes, parse_tables(wb, shapes, CTX)


def _period_key(cell: Any) -> str:
    p = cell.period
    return p.date.isoformat() if p.kind == "daily" and p.date else p.month_key


def _readings(result: TabularResult) -> dict[tuple[str, str], list[Any]]:
    """Every data cell of the result, by ``(label, period)``."""
    out: dict[tuple[str, str], list[Any]] = {}
    for item in [*result.mapped, *result.unmapped]:
        for c in item.cells:
            out.setdefault((item.label, _period_key(c)), []).append(c.raw)
    return out


def _assert_readings(result: TabularResult, expected: Expected) -> None:
    got = _readings(result)
    assert {k: v for k, v in got.items()} == {k: [v] for k, v in expected.items()}
    assert not any(v >= SENTINEL for vals in got.values() for v in vals)


values = st.integers(min_value=1, max_value=999_999).map(lambda n: n / 100)


@st.composite
def decoy_rows(draw: st.DrawFn, below_score: int) -> Grid:
    """Rows of text whose header score is strictly below ``below_score``.

    Each row mixes recognized cells (one point each) and unrecognized text (none).
    """
    rows: Grid = []
    for _ in range(draw(st.integers(min_value=1, max_value=4))):
        k = draw(st.integers(min_value=0, max_value=below_score - 1))
        recognized = draw(st.lists(st.sampled_from(RECOGNIZED), min_size=k, max_size=k))
        plain = draw(st.lists(st.sampled_from(UNRECOGNIZED), min_size=0, max_size=3))
        cells = [*recognized, *plain]
        rows.append(draw(st.permutations(cells)))
    return rows


# ---------------------------------------------------------------------------
# Table generators: (header, data rows, expected readings)
# ---------------------------------------------------------------------------


@st.composite
def cols_table(draw: st.DrawFn) -> tuple[Grid, Grid, Expected, int]:
    """``periods_in_columns``: a ``Stream`` header and months across."""
    months = draw(st.integers(min_value=2, max_value=6))
    labels = draw(st.permutations(STREAM_LABELS).map(list))[: draw(st.integers(2, 4))]
    header: Grid = [["Stream", *MONTHS[:months]]]
    data: Grid = []
    expected: Expected = {}
    for label in labels:
        row: list[Any] = [label]
        for m in MONTHS[:months]:
            v = draw(values)
            row.append(v)
            expected[(label, _month_key(m))] = v
        data.append(row)
    return header, data, expected, 1 + months


@st.composite
def rows_table(draw: st.DrawFn) -> tuple[Grid, Grid, Expected, int]:
    """``periods_in_rows``: a ``Date`` column and one column per stream."""
    streams = draw(st.permutations(STREAM_LABELS).map(list))[: draw(st.integers(2, 4))]
    days = draw(st.integers(min_value=1, max_value=6))
    start = draw(st.dates(min_value=date(2023, 4, 1), max_value=date(2024, 2, 1)))
    header: Grid = [["Date", *streams]]
    data: Grid = []
    expected: Expected = {}
    for i in range(days):
        d = start + timedelta(days=i)
        row: list[Any] = [datetime(d.year, d.month, d.day)]
        for label in streams:
            v = draw(values)
            row.append(v)
            expected[(label, d.isoformat())] = v
        data.append(row)
    return header, data, expected, 1 + len(streams)


@st.composite
def long_data(draw: st.DrawFn) -> tuple[Grid, Grid, Expected, int]:
    """``long``: one row per month and stream."""
    months = draw(st.integers(min_value=1, max_value=4))
    labels = draw(st.permutations(STREAM_LABELS).map(list))[: draw(st.integers(1, 3))]
    header: Grid = [["Month", "Stream", "Value", "Unit"]]
    data: Grid = []
    expected: Expected = {}
    for m in MONTHS[:months]:
        for label in labels:
            v = draw(values)
            data.append([m, label, v, "t"])
            expected[(label, _month_key(m))] = v
    return header, data, expected, 4


def _month_key(text: str) -> str:
    mon, yy = text.split("-")
    month = ("Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split().index(mon)) + 1
    return f"20{yy}-{month:02d}"


# ---------------------------------------------------------------------------
# Header choice (Requirement 7.4)
# ---------------------------------------------------------------------------

any_table = st.one_of(cols_table(), rows_table(), long_data())


@SETTINGS
@given(
    table=any_table,
    data=st.data(),
    separator=st.booleans(),
    title=st.booleans(),
)
def test_decoy_rows_with_fewer_recognized_labels_do_not_win(
    table: tuple[Grid, Grid, Expected, int], data: st.DataObject, separator: bool, title: bool
) -> None:
    header, body, expected, score = table
    decoys = data.draw(decoy_rows(score))
    grid: Grid = []
    if title:
        grid.append(["Plant Monthly Report"])
    grid.extend(decoys)
    if separator:
        grid.append([])  # a blank row between the decoys and the real header
    header_row = len(grid) + 1
    grid.extend([*header, *body])

    shapes, result = _parse(grid)

    assert len(shapes) == 1, f"no table found for grid {grid}"
    assert shapes[0].header_rows[-1] == header_row
    assert shapes[0].score == score
    if separator:
        # Rows joined above the header would rename columns, so only a separated table
        # is held to the exact readings.
        _assert_readings(result, expected)


@SETTINGS
@given(table=any_table, data=st.data())
def test_header_choice_is_independent_of_row_offset(
    table: tuple[Grid, Grid, Expected, int], data: st.DataObject
) -> None:
    """Moving the real header down under blank rows and decoys keeps the same readings."""
    header, body, expected, score = table
    decoys = data.draw(decoy_rows(score))
    plain = [[*header[0]], *body]
    _, base = _parse(plain)
    grid: Grid = [*decoys, [], *plain]
    shapes, moved = _parse(grid)
    assert len(shapes) == 1
    assert shapes[0].header_rows[-1] == len(decoys) + 2
    assert _readings(moved) == _readings(base)
    _assert_readings(moved, expected)


# ---------------------------------------------------------------------------
# Total rows and columns (Requirement 7.8)
# ---------------------------------------------------------------------------

total_label = st.sampled_from(TOTAL_LABELS)


def _insert(rows: list[Any], index: int, item: Any) -> None:
    rows.insert(min(index, len(rows)), item)


@SETTINGS
@given(
    table=cols_table(),
    col_total=st.one_of(st.none(), st.tuples(st.integers(0, 6), total_label)),
    row_total=st.one_of(st.none(), st.tuples(st.integers(0, 4), total_label)),
)
def test_totals_are_skipped_in_periods_in_columns(
    table: tuple[Grid, Grid, Expected, int],
    col_total: tuple[int, str] | None,
    row_total: tuple[int, str] | None,
) -> None:
    header, body, expected, _ = table
    grid: Grid = [list(header[0]), *[list(r) for r in body]]
    width = len(header[0])
    if col_total is not None:
        pos, text = col_total
        pos = 1 + min(pos, width - 1)  # after the label column, among or after the periods
        for i, row in enumerate(grid):
            row.insert(pos, text if i == 0 else SENTINEL + i)
    if row_total is not None:
        pos, text = row_total
        row = [text, *[SENTINEL + j for j in range(len(grid[0]) - 1)]]
        _insert(grid, 1 + pos, row)

    shapes, result = _parse(grid)

    assert [s.layout for s in shapes] == ["periods_in_columns"]
    _assert_readings(result, expected)


@SETTINGS
@given(
    table=rows_table(),
    col_total=st.one_of(st.none(), st.tuples(st.integers(0, 4), total_label)),
    row_total=st.one_of(st.none(), st.tuples(st.integers(0, 6), total_label)),
)
def test_totals_are_skipped_in_periods_in_rows(
    table: tuple[Grid, Grid, Expected, int],
    col_total: tuple[int, str] | None,
    row_total: tuple[int, str] | None,
) -> None:
    header, body, expected, _ = table
    grid: Grid = [list(header[0]), *[list(r) for r in body]]
    width = len(header[0])
    if col_total is not None:
        pos, text = col_total
        pos = 1 + min(pos, width - 1)
        for i, row in enumerate(grid):
            row.insert(pos, text if i == 0 else SENTINEL + i)
    if row_total is not None:
        pos, text = row_total
        row = [text, *[SENTINEL + j for j in range(len(grid[0]) - 1)]]
        _insert(grid, 1 + pos, row)

    shapes, result = _parse(grid)

    assert [s.layout for s in shapes] == ["periods_in_rows"]
    _assert_readings(result, expected)


@SETTINGS
@given(
    table=long_data(),
    totals=st.lists(
        st.tuples(
            st.integers(0, 12),
            total_label,
            st.sampled_from(["stream", "period"]),
        ),
        min_size=1,
        max_size=4,
    ),
)
def test_totals_are_skipped_in_long_layout(
    table: tuple[Grid, Grid, Expected, int],
    totals: list[tuple[int, str, str]],
) -> None:
    header, body, expected, _ = table
    grid: Grid = [list(header[0]), *[list(r) for r in body]]
    for n, (pos, text, where) in enumerate(totals):
        if where == "stream":
            row = [MONTHS[0], text, SENTINEL + n, "t"]
        else:
            row = [text, STREAM_LABELS[0], SENTINEL + n, "t"]
        _insert(grid, 1 + pos, row)

    shapes, result = _parse(grid)

    assert [s.layout for s in shapes] == ["long"]
    _assert_readings(result, expected)
