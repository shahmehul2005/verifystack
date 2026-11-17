"""Property 17: Layout equivalence.

Feature: industrial-extractor, Property 17: Layout equivalence.

For any set of (period, stream, value, unit) readings, writing it as a ``long``, a
``periods_in_columns`` or a ``periods_in_rows`` table and parsing each gives the same set of
readings, differing only in provenance cells.

**Validates: Requirements 7.1, 7.2, 7.3**
"""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any

from hypothesis import given, settings
from hypothesis import strategies as st

from services.extractor.dates import parse_fy_label
from services.extractor.models import BEEPATSectorStream
from services.extractor.tabular import TabularContext, TabularResult, detect_tables, parse_tables
from services.extractor.tests.factories import (
    decimals,
    long_table,
    periods_in_columns,
    periods_in_rows,
)
from services.extractor.workbook import load_workbook_bytes

FY = "FY2023-24"
MONTH_ABBR = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
FY_MONTHS = [(2023, m) for m in range(4, 13)] + [(2024, m) for m in range(1, 4)]
UNITS = ("t", "kg", "kWh")

# A period is ("monthly", year, month) or ("daily", year, month, day).
Period = tuple[Any, ...]
# What the parser must return for one reading: (kind, month_key, date, stream, value, unit).
Reading = tuple[str, str, date | None, str, float, str]


@st.composite
def reading_sets(draw: st.DrawFn) -> tuple[str, dict[tuple[Period, BEEPATSectorStream], Decimal], dict[BEEPATSectorStream, str]]:
    """``(kind, values, units)``.

    ``values`` maps (period, stream) to a positive value. It holds at least two periods
    and two streams, every period and every stream has a reading, and the grid may be
    sparse. ``units`` gives each stream one unit, because a wide layout can carry only one
    per row or column.
    """
    kind = draw(st.sampled_from(["monthly", "daily"]))
    if kind == "monthly":
        picked = draw(st.lists(st.sampled_from(FY_MONTHS), min_size=2, max_size=6, unique=True))
        periods: list[Period] = sorted(("monthly", y, m) for y, m in picked)
    else:
        # Days 2..28 so a set of dates is never read as a set of first-of-month months.
        days = st.builds(
            lambda ym, d: (ym[0], ym[1], d),
            st.sampled_from(FY_MONTHS),
            st.integers(min_value=2, max_value=28),
        )
        picked_days = draw(st.lists(days, min_size=2, max_size=6, unique=True))
        periods = sorted(("daily", y, m, d) for y, m, d in picked_days)
    streams = sorted(
        draw(
            st.lists(st.sampled_from(list(BEEPATSectorStream)), min_size=2, max_size=5, unique=True)
        ),
        key=lambda s: s.value,
    )
    present = {
        (p, s): draw(st.booleans()) for p in periods for s in streams
    }
    for i, p in enumerate(periods):  # every period has a reading
        present[(p, streams[i % len(streams)])] = True
    for j, s in enumerate(streams):  # every stream has a reading
        present[(periods[j % len(periods)], s)] = True
    values = {
        key: draw(decimals(max_int_digits=7, max_places=3)) for key, on in present.items() if on
    }
    units = {s: draw(st.sampled_from(UNITS)) for s in streams}
    return kind, values, units


def _cell_value(p: Period) -> Any:
    """How a period is written in a cell: month text, or a real date cell."""
    if p[0] == "monthly":
        _, y, m = p
        return f"{MONTH_ABBR[m - 1]}-{y % 100:02d}"
    _, y, m, d = p
    return datetime(y, m, d)


def _expected(
    values: dict[tuple[Period, BEEPATSectorStream], Decimal], units: dict[BEEPATSectorStream, str]
) -> list[Reading]:
    out: list[Reading] = []
    for (p, s), v in values.items():
        key = f"{p[1]:04d}-{p[2]:02d}"
        when = date(p[1], p[2], p[3]) if p[0] == "daily" else None
        out.append((p[0], key, when, s.value, float(v), units[s]))
    return sorted(out, key=repr)


def _write_long(kind, values, units) -> bytes:
    header = "Month" if kind == "monthly" else "Date"
    records = [
        (_cell_value(p), s.value, float(v), units[s])
        for (p, s), v in sorted(values.items(), key=lambda kv: (kv[0][0], kv[0][1].value))
    ]
    return long_table(records, headers=(header, "Stream", "Value", "Unit"))


def _grid(values, kind, streams, periods) -> list[tuple[str, list[Any]]]:
    return [
        (
            s.value,
            [float(values[(p, s)]) if (p, s) in values else None for p in periods],
        )
        for s in streams
    ]


def _axes(values):
    periods = sorted({p for p, _ in values})
    streams = sorted({s for _, s in values}, key=lambda s: s.value)
    return periods, streams


def _write_columns(kind, values, units, *, unit_column: bool) -> bytes:
    periods, streams = _axes(values)
    series = _grid(values, kind, streams, periods)
    heads = [_cell_value(p) for p in periods]
    if unit_column:
        return periods_in_columns(
            heads, series, unit_column=True, units=[units[s] for s in streams]
        )
    labelled = [(f"{label} ({units[s]})", vals) for (label, vals), s in zip(series, streams)]
    return periods_in_columns(heads, labelled)


def _write_rows(kind, values, units) -> bytes:
    periods, streams = _axes(values)
    series = _grid(values, kind, streams, periods)
    columns = [(f"{label} ({units[s]})", vals) for (label, vals), s in zip(series, streams)]
    header = "Month" if kind == "monthly" else "Date"
    return periods_in_rows([_cell_value(p) for p in periods], columns, period_header=header)


def _parse(data: bytes) -> tuple[list[str], TabularResult]:
    wb = load_workbook_bytes(data, "xlsx")
    shapes = [shape for sheet in wb.sheets for shape in detect_tables(sheet)]
    result = parse_tables(wb, shapes, TabularContext(parse_fy_label(FY)))
    return [s.layout for s in shapes], result


def _readings(result: TabularResult) -> list[Reading]:
    out: list[Reading] = []
    for m in result.mapped:
        for c in m.cells:
            assert c.period is not None and c.unit is not None
            out.append((c.period.kind, c.period.month_key, c.period.date, m.stream.value, float(c.raw), c.unit))
    return sorted(out, key=repr)


def _refs(result: TabularResult) -> list[str]:
    return [c.cell for m in result.mapped for c in m.cells]


@settings(max_examples=60, deadline=None)
@given(data=reading_sets(), unit_column=st.booleans())
def test_three_layouts_give_the_same_readings(
    data: tuple[str, dict[tuple[Period, BEEPATSectorStream], Decimal], dict[BEEPATSectorStream, str]],
    unit_column: bool,
) -> None:
    kind, values, units = data
    expected = _expected(values, units)

    layouts = {
        "long": _write_long(kind, values, units),
        "periods_in_columns": _write_columns(kind, values, units, unit_column=unit_column),
        "periods_in_rows": _write_rows(kind, values, units),
    }

    seen: dict[str, list[Reading]] = {}
    for name, blob in layouts.items():
        found_layouts, result = _parse(blob)
        assert found_layouts == [name]
        # Nothing is left for the model, skipped or flagged: every label maps by rule.
        assert result.unmapped == []
        assert result.skipped == []
        assert result.warnings == []
        got = _readings(result)
        assert got == expected, name
        # Provenance is real: one distinct cell per reading.
        refs = _refs(result)
        assert len(refs) == len(set(refs)) == len(expected)
        seen[name] = got

    assert seen["long"] == seen["periods_in_columns"] == seen["periods_in_rows"]


def test_fixed_example_gives_the_same_readings_from_cells_in_different_places() -> None:
    """The same four readings, written three ways, parse alike. The long layout puts the
    values in one column, so its cell references differ from the wide layouts'."""
    values = {
        (("monthly", 2023, 4), BEEPATSectorStream.CLINKER_PRODUCTION): Decimal("1000.5"),
        (("monthly", 2023, 5), BEEPATSectorStream.CLINKER_PRODUCTION): Decimal("1100"),
        (("monthly", 2023, 4), BEEPATSectorStream.COAL_QUANTITY): Decimal("50"),
        (("monthly", 2023, 5), BEEPATSectorStream.COAL_QUANTITY): Decimal("60"),
    }
    units = {BEEPATSectorStream.CLINKER_PRODUCTION: "t", BEEPATSectorStream.COAL_QUANTITY: "t"}
    expected = _expected(values, units)

    refs: dict[str, list[str]] = {}
    for name, blob in {
        "long": _write_long("monthly", values, units),
        "periods_in_columns": _write_columns("monthly", values, units, unit_column=False),
        "periods_in_rows": _write_rows("monthly", values, units),
    }.items():
        layouts, result = _parse(blob)
        assert layouts == [name]
        assert _readings(result) == expected
        refs[name] = sorted(_refs(result))

    assert refs["long"] == ["C2", "C3", "C4", "C5"]
    assert refs["long"] != refs["periods_in_columns"]
