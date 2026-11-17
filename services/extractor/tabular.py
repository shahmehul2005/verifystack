"""Tabular_Parser: reads spreadsheet tables of streams and periods.

The parser works in two steps.

1. ``detect_tables`` finds the header row of a sheet. Each of the first 60 rows
   with at least two text or date cells gets a score: the count of cells that are
   a stream label (Rules_Mapper ``mapped`` or ``ambiguous``), a month or date
   header, or a long-layout column name. The highest score wins and the earliest
   row breaks a tie. A score under 2 means the sheet has no table (Requirement
   7.4). Up to two rows directly above the header row that hold text in a column
   are joined into the column name, merged ranges included (Requirement 7.5). A
   merged range that covers 80% or more of the used width, a text cell longer
   than 80 characters, or a lone unmerged text cell above the header is a title.
   Titles are not joined. They feed the Rules_Mapper title step.
2. ``parse_tables`` reads the data cells in one of three layouts:

   * ``long``: columns for the period, the stream and the value, and optionally a
     unit. One reading per data row (Requirement 7.1).
   * ``periods_in_columns``: two or more headers are dates or months, and the
     first column holds stream labels (Requirements 7.2, 7.3).
   * ``periods_in_rows``: a Date or Month column with two or more stream headers
     across. The Shyamrock plant logs use this shape (design decision D2).

The parser emits no ``Reading``. It returns data cells grouped under their
label: ``MappedLabel`` for labels the Rules_Mapper placed and ``LabelItem`` for the
rest, which go to the Mapper_Agent (Requirement 9.3). The pipeline builds the
readings from them. Every ``DataCell`` carries the real sheet name and the real A1
address of the source cell (Requirement 7.10).

Rules that hold in every layout:

* A unit in parentheses in a header or label is the unit of the values
  (Requirement 7.6). A cell in a Unit column wins over a parenthetical.
* Rows and columns labelled ``Total``, ``Grand Total``, ``Sub-total`` or
  ``Subtotal`` are skipped (Requirement 7.8). ``Total Clinker Production`` is not.
* Blank and non-numeric cells are skipped. Numeric text such as ``"1,234.5"`` is
  read. Date cells are never read as values.
* A date or month outside the Fiscal_Year_Window keeps its cells, adds
  ``outside_fiscal_year`` to their review reasons and adds one warning that holds
  the date (Requirement 7.9). Annual periods are not checked.
* Dates are day first, or Excel serial numbers under a date column
  (Requirement 7.7). Date headers or values that are all the first day of a
  month, with two or more distinct values, are read as months.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any, Literal

from .dates import FiscalWindow, from_excel_serial, parse_period_text
from .models import (
    BEEPATSectorStream,
    DataCell,
    ExtractorWarning,
    LabelItem,
    Period,
    SkippedItem,
)
from .streams import MapResult, match_label
from .units import parse_number, unit_from_label
from .workbook import Cell, Sheet, Workbook, make_raw_id

__all__ = [
    "MappedLabel",
    "TabularContext",
    "TableShape",
    "TabularResult",
    "detect_tables",
    "parse_tables",
]

Layout = Literal["long", "periods_in_columns", "periods_in_rows"]

_HEADER_SCAN_ROWS = 60
_TITLE_WIDTH_RATIO = 0.8
_TITLE_MAX_CHARS = 80
_MAX_JOIN_ROWS = 2
_TITLE_SCAN_ROWS = 10
_MAX_MERGE_COLS = 512
_MIN_SERIAL_YEAR = 1990
_MAX_SERIAL_YEAR = 2100
_DUMMY_FY = FiscalWindow(start_year=2000)  # lets a bare month name count as a header

_PERIOD_NAMES = frozenset(
    {
        "month",
        "months",
        "date",
        "dates",
        "period",
        "day",
        "reporting month",
        "reporting period",
        "month year",
        "for the month",
    }
)
_STREAM_NAMES = frozenset(
    {
        "stream",
        "streams",
        "item",
        "items",
        "parameter",
        "parameters",
        "particulars",
        "description",
        "stream key",
        "stream name",
    }
)
_VALUE_NAMES = frozenset({"value", "values", "quantity", "qty", "reading", "readings", "amount"})
_UNIT_NAMES = frozenset({"unit", "units", "uom", "unit of measure"})
_IGNORE_NAMES = frozenset(
    {
        "source",
        "sources",
        "remark",
        "remarks",
        "note",
        "notes",
        "comment",
        "comments",
        "reference",
        "ref",
        "document",
        "sr no",
        "s no",
        "sl no",
        "sno",
        "serial no",
        "serial number",
        "no",
        "sr",
        "sl",
    }
)
_TOTAL_NAMES = frozenset({"total", "grand total", "sub total", "subtotal"})

_PAREN_RE = re.compile(r"\([^()]*\)")
_NON_WORD_RE = re.compile(r"[\W_]+")


# ---------------------------------------------------------------------------
# Public types
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class TabularContext:
    """Settings shared by the parsers. ``fiscal_window`` is ``None`` when the
    compliance year is unknown or does not parse; the window check is then skipped
    and month names without a year are skipped as ``year_unresolved``."""

    fiscal_window: FiscalWindow | None = None


@dataclass
class TableShape:
    """A table found on a sheet."""

    sheet: str
    header_rows: tuple[int, ...]
    layout: Layout
    title: str
    score: int
    # Column analysis kept for parse_tables. Not part of equality or repr.
    _plan: _Plan | None = field(default=None, repr=False, compare=False)


class MappedLabel(LabelItem):
    """A label the Rules_Mapper placed, with the data cells it governs."""

    stream: BEEPATSectorStream
    rule: Literal["key", "phrase", "title"]


@dataclass
class TabularResult:
    mapped: list[MappedLabel] = field(default_factory=list)
    unmapped: list[LabelItem] = field(default_factory=list)  # for the Mapper_Agent
    skipped: list[SkippedItem] = field(default_factory=list)
    warnings: list[ExtractorWarning] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Text helpers
# ---------------------------------------------------------------------------


def _text(cell: Cell | None) -> str:
    if cell is None or not isinstance(cell.value, str):
        return ""
    return cell.value.strip()


def _role_key(text: str) -> str:
    """Normalize a header for role lookup: no parentheticals, lowercase, single spaces."""
    s = unicodedata.normalize("NFKC", _PAREN_RE.sub(" ", text)).lower()
    return _NON_WORD_RE.sub(" ", s).strip()


def _role(text: str) -> str | None:
    key = _role_key(text)
    if key in _PERIOD_NAMES:
        return "period"
    if key in _STREAM_NAMES:
        return "stream"
    if key in _VALUE_NAMES:
        return "value"
    if key in _UNIT_NAMES:
        return "unit"
    if key in _IGNORE_NAMES:
        return "ignore"
    return None


def _is_total(text: str) -> bool:
    return _role_key(unit_from_label(text)[0]) in _TOTAL_NAMES


def _is_dated(cell: Cell | None) -> bool:
    return cell is not None and isinstance(cell.value, date)


def _is_numeric(cell: Cell | None) -> bool:
    if cell is None:
        return False
    v = cell.value
    if isinstance(v, bool) or isinstance(v, date):
        return False
    if isinstance(v, (int, float)):
        return v == v and v not in (float("inf"), float("-inf"))
    if isinstance(v, str):
        return parse_number(v) is not None
    return False


def _daily(d: date) -> Period:
    return Period(kind="daily", month_key=d.strftime("%Y-%m"), date=d)


def _to_monthly(p: Period) -> Period:
    return Period(kind="monthly", month_key=p.month_key)


def _serial_date(value: float, epoch: Literal[1900, 1904]) -> date | None:
    if value != int(value):
        return None
    d = from_excel_serial(value, epoch)
    if d is None or not (_MIN_SERIAL_YEAR <= d.year <= _MAX_SERIAL_YEAR):
        return None
    return d


def _period_of(
    value: Any, fy: FiscalWindow | None, epoch: Literal[1900, 1904]
) -> tuple[Period | None, str]:
    """Read a period from a cell value.

    The status is ``ok``, ``blank``, ``total``, ``year_unresolved`` (a month name
    that needs the fiscal year) or ``period_unresolved``.
    """
    if value is None:
        return None, "blank"
    if isinstance(value, datetime):
        return _daily(value.date()), "ok"
    if isinstance(value, date):
        return _daily(value), "ok"
    if isinstance(value, bool):
        return None, "period_unresolved"
    if isinstance(value, (int, float)):
        d = _serial_date(value, epoch)
        return (_daily(d), "ok") if d else (None, "period_unresolved")
    if isinstance(value, str):
        s = value.strip()
        if not s:
            return None, "blank"
        if _is_total(s):
            return None, "total"
        p = parse_period_text(s, fy)
        if p is not None:
            return p, "ok"
        n = parse_number(s)
        if n is not None:
            d = _serial_date(float(n), epoch)
            if d:
                return _daily(d), "ok"
        if fy is None and parse_period_text(s, _DUMMY_FY) is not None:
            return None, "year_unresolved"
        return None, "period_unresolved"
    return None, "period_unresolved"


def _first_of_month_to_monthly(periods: list[Period | None], name_hint: str = "") -> list[Period | None]:
    """Read a set of dates that are all the first of a month as months.

    A spreadsheet stores ``Apr-23`` as 1 April 2023, so a month header arrives as
    a date. Two or more distinct first-of-month dates, or one under a header that
    says ``month``, are months.
    """
    dailies = [p for p in periods if p is not None and p.kind == "daily" and p.date]
    if not dailies or any(p.date.day != 1 for p in dailies):  # type: ignore[union-attr]
        return periods
    distinct = {p.date for p in dailies}
    if len(distinct) < 2 and "month" not in name_hint.lower():
        return periods
    return [_to_monthly(p) if p is not None and p.kind == "daily" else p for p in periods]


def _outside(period: Period | None, fw: FiscalWindow | None) -> bool:
    if period is None or fw is None or period.kind == "annual":
        return False
    if period.kind == "daily" and period.date is not None:
        return not fw.contains(period.date)
    year, month = int(period.month_key[:4]), int(period.month_key[5:7])
    return not fw.contains(date(year, month, 1))


# ---------------------------------------------------------------------------
# Header detection
# ---------------------------------------------------------------------------


@dataclass
class _Col:
    col: int
    bottom: str  # text of the bottom header cell; "" for a date cell
    value: Any  # raw bottom header value
    name: str  # joined multi-row name
    role: str | None
    period: Period | None  # header read as a period with a stand-in fiscal year
    total: bool
    raw_row: int  # header row


@dataclass
class _Plan:
    header_row: int
    cols: list[_Col]
    layout: Layout
    period_col: int | None = None
    stream_col: int | None = None
    value_col: int | None = None
    unit_col: int | None = None
    label_col: int | None = None
    period_cols: list[_Col] = field(default_factory=list)
    stream_cols: list[_Col] = field(default_factory=list)


def _rows(sheet: Sheet) -> dict[int, dict[int, Cell]]:
    out: dict[int, dict[int, Cell]] = {}
    for (r, c), cell in sheet.cells.items():
        out.setdefault(r, {})[c] = cell
    return out


def _is_header_like(cell: Cell) -> bool:
    return bool(_text(cell)) or (_is_dated(cell) and cell.is_date)


def _scores(cell: Cell) -> bool:
    """Does this header-like cell count toward the header-row score?"""
    if _is_dated(cell):
        return True
    text = _text(cell)
    if not text:
        return False
    key = _role_key(text)
    if key in _PERIOD_NAMES or key in _STREAM_NAMES or key in _VALUE_NAMES or key in _UNIT_NAMES:
        return True
    if key in ("source", "sources"):
        return True
    p = parse_period_text(unit_from_label(text)[0], _DUMMY_FY)
    if p is not None and p.kind != "annual":
        return True
    return match_label(text).status != "none"


@dataclass
class _Entry:
    cell: Cell
    min_col: int
    max_col: int
    title: bool


def _row_entries(
    sheet: Sheet, row: int, cells: dict[int, Cell], used_width: int
) -> tuple[list[_Entry], bool]:
    """Text entries of a row, with merged spans, and whether the row is text only.

    A row holds numeric or date cells (``False``) cannot be a header row.
    """
    if any(not isinstance(c.value, str) for c in cells.values()):
        return [], False
    entries: list[_Entry] = []
    seen: set[tuple[int, int]] = set()
    for rng in sheet.merged:
        if not (rng.min_row <= row <= rng.max_row):
            continue
        top_left = sheet.cells.get((rng.min_row, rng.min_col))
        if top_left is None or not isinstance(top_left.value, str) or not top_left.value.strip():
            continue
        if rng.max_col - rng.min_col >= _MAX_MERGE_COLS:
            continue
        seen.add((top_left.row, top_left.col))
        wide = (rng.max_col - rng.min_col + 1) >= _TITLE_WIDTH_RATIO * used_width
        entries.append(
            _Entry(
                top_left,
                rng.min_col,
                rng.max_col,
                wide or len(top_left.value.strip()) > _TITLE_MAX_CHARS,
            )
        )
    plain = [
        c
        for c in cells.values()
        if (c.row, c.col) not in seen and c.value.strip() and sheet.merged_range_at(c.row, c.col) is None
    ]
    for c in plain:
        entries.append(_Entry(c, c.col, c.col, len(c.value.strip()) > _TITLE_MAX_CHARS))
    # A lone unmerged text cell is a caption, not a column header.
    if len(entries) == 1 and entries[0].min_col == entries[0].max_col:
        entries[0].title = True
    return entries, True


def _join_and_title(
    sheet: Sheet, by_row: dict[int, dict[int, Cell]], header_row: int
) -> tuple[list[int], dict[int, list[str]], list[str]]:
    """Rows to join above the header, their text by column, and the title texts."""
    used_width = max(sheet.max_col, 1)
    join_rows: list[int] = []
    parts: dict[int, list[tuple[int, str]]] = {}
    titles: list[str] = []
    stop = False
    for r in range(header_row - 1, max(header_row - _MAX_JOIN_ROWS, 1) - 1, -1):
        entries, text_only = _row_entries(sheet, r, by_row.get(r, {}), used_width)
        usable = [e for e in entries if not e.title]
        if stop or not text_only or not usable:
            stop = True
            if text_only:
                titles.extend(e.cell.value.strip() for e in entries if e.title)
            continue
        join_rows.append(r)
        for e in entries:
            if e.title:
                titles.append(e.cell.value.strip())
                continue
            for c in range(e.min_col, e.max_col + 1):
                parts.setdefault(c, []).append((r, e.cell.value.strip()))
    join_rows.sort()
    ordered: dict[int, list[str]] = {}
    for c, items in parts.items():
        ordered[c] = [t for _, t in sorted(items, key=lambda it: it[0])]

    top = min(join_rows + [header_row])
    for r in range(max(top - _TITLE_SCAN_ROWS, 1), top):
        if r in join_rows:
            continue
        entries, text_only = _row_entries(sheet, r, by_row.get(r, {}), used_width)
        if text_only:
            titles.extend(e.cell.value.strip() for e in entries if e.title)
    return join_rows, ordered, list(dict.fromkeys(titles))


def _columns(
    sheet: Sheet, header_row: int, joined: dict[int, list[str]]
) -> list[_Col]:
    cols: set[int] = {c for (r, c) in sheet.cells if r == header_row}
    for rng in sheet.merged:
        if rng.min_row <= header_row <= rng.max_row and rng.max_col - rng.min_col < _MAX_MERGE_COLS:
            cols.update(range(rng.min_col, rng.max_col + 1))
    out: list[_Col] = []
    for c in sorted(cols):
        hc = sheet.header_cell(header_row, c)
        if hc is None or hc.value is None:
            continue
        bottom = hc.value.strip() if isinstance(hc.value, str) else ""
        if not bottom and not _is_dated(hc):
            continue
        parts: list[str] = []
        for part in [*joined.get(c, []), bottom]:
            if part and (not parts or parts[-1] != part):
                parts.append(part)
        name = " ".join(parts)
        role = (_role(bottom) or _role(name)) if bottom else None
        period: Period | None = None
        if isinstance(hc.value, datetime):
            period = _daily(hc.value.date())
        elif isinstance(hc.value, date):
            period = _daily(hc.value)
        elif bottom and role is None:
            period = parse_period_text(unit_from_label(bottom)[0], _DUMMY_FY)
            if period is None and name != bottom:
                period = parse_period_text(unit_from_label(name)[0], _DUMMY_FY)
        out.append(
            _Col(
                col=c,
                bottom=bottom,
                value=hc.value,
                name=name,
                role=role,
                period=period,
                total=bool(bottom) and _is_total(bottom),
                raw_row=header_row,
            )
        )
    return out


def _decide(header_row: int, cols: list[_Col]) -> _Plan | None:
    def first(role: str) -> _Col | None:
        return next((c for c in cols if c.role == role and not c.total), None)

    p, s, v, u = first("period"), first("stream"), first("value"), first("unit")
    if p and s and v:
        return _Plan(
            header_row,
            cols,
            "long",
            period_col=p.col,
            stream_col=s.col,
            value_col=v.col,
            unit_col=u.col if u else None,
        )

    period_cols = [
        c
        for c in cols
        if c.period is not None and c.period.kind != "annual" and not c.total and c.role is None
    ]
    if len(period_cols) >= 2:
        first_period = period_cols[0].col
        left = [
            c.col
            for c in cols
            if c.col < first_period and c.role in ("stream", None) and not c.total and c.period is None
        ]
        if left:
            label_col: int | None = min(left)
        elif first_period > 1 and (u is None or u.col != 1):
            label_col = 1
        else:
            label_col = None
        if label_col is not None:
            return _Plan(
                header_row,
                cols,
                "periods_in_columns",
                label_col=label_col,
                unit_col=u.col if u else None,
                period_cols=period_cols,
            )

    if p:
        stream_cols = [
            c
            for c in cols
            if c.role is None and c.period is None and not c.total and c.bottom and c.col != p.col
        ]
        if len(stream_cols) >= 2:
            return _Plan(
                header_row,
                cols,
                "periods_in_rows",
                period_col=p.col,
                unit_col=u.col if u else None,
                stream_cols=stream_cols,
            )
    return None


def _analyze(sheet: Sheet) -> TableShape | None:
    by_row = _rows(sheet)
    best_score, best_row = 0, 0
    for r in sorted(by_row):
        if r > _HEADER_SCAN_ROWS:
            break
        header_cells = [c for c in by_row[r].values() if _is_header_like(c)]
        if len(header_cells) < 2:
            continue
        score = sum(1 for c in header_cells if _scores(c))
        if score > best_score:  # strict: the earliest row wins a tie
            best_score, best_row = score, r
    if best_score < 2:
        return None

    join_rows, joined, titles = _join_and_title(sheet, by_row, best_row)
    cols = _columns(sheet, best_row, joined)
    plan = _decide(best_row, cols)
    if plan is None:
        return None
    title = " ".join([sheet.name, *titles]).strip()
    return TableShape(
        sheet=sheet.name,
        header_rows=(*join_rows, best_row),
        layout=plan.layout,
        title=title,
        score=best_score,
        _plan=plan,
    )


def detect_tables(sheet: Sheet) -> list[TableShape]:
    """Find the table on a sheet. The list holds at most one shape."""
    try:
        shape = _analyze(sheet)
    except (ValueError, TypeError):  # a malformed cell must not fail the whole file
        return []
    return [shape] if shape is not None else []


# ---------------------------------------------------------------------------
# Reading
# ---------------------------------------------------------------------------


@dataclass
class _Group:
    label: str
    raw_id: str
    unit_hint: str | None
    cells: list[DataCell] = field(default_factory=list)


class _Reader:
    def __init__(self, wb: Workbook, ctx: TabularContext, shape: TableShape, sheet: Sheet) -> None:
        self.fy = ctx.fiscal_window
        self.epoch = wb.epoch
        self.shape = shape
        self.sheet = sheet
        self.groups: dict[Any, _Group] = {}
        self.skipped: list[SkippedItem] = []
        self.warnings: list[ExtractorWarning] = []
        self._warned: set[str] = set()

    def add(
        self,
        key: Any,
        label: str,
        raw_id: str,
        unit_hint: str | None,
        cell: Cell,
        unit: str | None,
        period: Period | None,
        context: str,
    ) -> None:
        group = self.groups.get(key)
        if group is None:
            group = self.groups[key] = _Group(label=label, raw_id=raw_id, unit_hint=unit_hint)
        if group.unit_hint is None and unit_hint is not None:
            group.unit_hint = unit_hint
        reasons: list[str] = []
        if _outside(period, self.fy):
            reasons.append("outside_fiscal_year")
            self._warn_outside(period, cell)
        source = f"{label} | {context} | {cell.value}"[:300]
        group.cells.append(
            DataCell(
                sheet=cell.sheet,
                cell=cell.ref,
                raw=cell.value,
                formula=cell.formula,
                unit=unit,
                period=period,
                source_text=source,
                review_reasons=reasons,
            )
        )

    def _warn_outside(self, period: Period | None, cell: Cell) -> None:
        assert period is not None and self.fy is not None
        text = period.date.isoformat() if period.date else period.month_key
        if text in self._warned:
            return
        self._warned.add(text)
        self.warnings.append(
            ExtractorWarning(
                code="outside_fiscal_year",
                message=(
                    f"Period {text} on sheet '{cell.sheet}' is outside the fiscal year "
                    f"{self.fy.start.isoformat()} to {self.fy.end.isoformat()}"
                ),
                raw_id=cell.raw_id,
            )
        )

    def skip(self, raw_id: str, label: str, reason: str, detail: str = "") -> None:
        self.skipped.append(
            SkippedItem(raw_id=raw_id, label=label[:80] or None, reason=reason, detail=detail[:60] or None)
        )


def _display(value: Any) -> str:
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    return "" if value is None else str(value).strip()


def _read_long(rd: _Reader, plan: _Plan, by_row: dict[int, dict[int, Cell]]) -> None:
    value_hdr = next(c for c in plan.cols if c.col == plan.value_col)
    value_unit = unit_from_label(value_hdr.name)[1]
    rows = [r for r in sorted(by_row) if r > plan.header_row]

    parsed: dict[int, tuple[Period | None, str]] = {}
    for r in rows:
        cells = by_row[r]
        if not _is_numeric(cells.get(plan.value_col)):
            continue
        pcell = cells.get(plan.period_col)
        parsed[r] = _period_of(pcell.value if pcell else None, rd.fy, rd.epoch)
    order = list(parsed)
    period_hdr = next(c for c in plan.cols if c.col == plan.period_col)
    normalized = _first_of_month_to_monthly([parsed[r][0] for r in order], period_hdr.name)
    for r, p in zip(order, normalized):
        parsed[r] = (p, parsed[r][1])

    for r in rows:
        if r not in parsed:
            continue
        cells = by_row[r]
        vcell = cells[plan.value_col]
        label = _text(cells.get(plan.stream_col))
        if not label or _is_total(label):
            continue
        period, status = parsed[r]
        if status == "total":
            continue
        if period is None:
            pcell = cells.get(plan.period_col)
            rd.skip(vcell.raw_id, label, status if status != "blank" else "period_unresolved", _display(pcell.value if pcell else None))
            continue
        ucell = cells.get(plan.unit_col) if plan.unit_col else None
        unit = _text(ucell) or value_unit or unit_from_label(label)[1]
        scell = cells[plan.stream_col]
        rd.add(
            key=("long", label.casefold()),
            label=label,
            raw_id=scell.raw_id,
            unit_hint=unit,
            cell=vcell,
            unit=unit,
            period=period,
            context=_display(cells[plan.period_col].value) if plan.period_col in cells else "",
        )


def _resolve_header_periods(rd: _Reader, plan: _Plan) -> dict[int, Period | None]:
    """Read the period of each period column with the real fiscal year."""
    periods: dict[int, Period | None] = {}
    for c in plan.period_cols:
        p, status = _period_of(c.value, rd.fy, rd.epoch)
        if p is None and c.name != c.bottom:
            p2, status2 = _period_of(unit_from_label(c.name)[0], rd.fy, rd.epoch)
            if p2 is not None or status != "year_unresolved":
                p, status = p2, status2
        if p is None:
            if status == "year_unresolved":
                rd.skip(make_raw_id(rd.sheet.name, c.raw_row, c.col), c.bottom, "year_unresolved")
            periods[c.col] = None
        else:
            periods[c.col] = p
    cols = list(periods)
    normalized = _first_of_month_to_monthly([periods[c] for c in cols])
    return dict(zip(cols, normalized))


def _read_periods_in_columns(rd: _Reader, plan: _Plan, by_row: dict[int, dict[int, Cell]]) -> None:
    periods = _resolve_header_periods(rd, plan)
    hdr_units = {c.col: unit_from_label(c.name)[1] for c in plan.period_cols}
    for r in sorted(by_row):
        if r <= plan.header_row:
            continue
        cells = by_row[r]
        lcell = cells.get(plan.label_col)
        label = _text(lcell)
        if not label or _is_total(label):
            continue
        ucell = cells.get(plan.unit_col) if plan.unit_col else None
        row_unit = _text(ucell) or unit_from_label(label)[1]
        for c in plan.period_cols:
            period = periods.get(c.col)
            cell = cells.get(c.col)
            if period is None or not _is_numeric(cell):
                continue
            assert lcell is not None and cell is not None
            unit = row_unit or hdr_units.get(c.col)
            rd.add(
                key=("row", r),
                label=label,
                raw_id=lcell.raw_id,
                unit_hint=unit,
                cell=cell,
                unit=unit,
                period=period,
                context=c.bottom or _display(c.value),
            )


def _read_periods_in_rows(rd: _Reader, plan: _Plan, by_row: dict[int, dict[int, Cell]]) -> None:
    pcol = next(c for c in plan.cols if c.col == plan.period_col)
    rows = [r for r in sorted(by_row) if r > plan.header_row]
    stream_cols = plan.stream_cols

    parsed: dict[int, tuple[Period | None, str]] = {}
    for r in rows:
        cells = by_row[r]
        if not any(_is_numeric(cells.get(c.col)) for c in stream_cols):
            continue
        pcell = cells.get(plan.period_col)
        parsed[r] = _period_of(pcell.value if pcell else None, rd.fy, rd.epoch)
    order = list(parsed)
    normalized = _first_of_month_to_monthly([parsed[r][0] for r in order], pcol.name)
    for r, p in zip(order, normalized):
        parsed[r] = (p, parsed[r][1])

    for r in rows:
        if r not in parsed:
            continue
        cells = by_row[r]
        period, status = parsed[r]
        if status == "total":
            continue
        pcell = cells.get(plan.period_col)
        if period is None:
            first = next(c for c in stream_cols if _is_numeric(cells.get(c.col)))
            cell = cells[first.col]
            rd.skip(cell.raw_id, first.name, status if status != "blank" else "period_unresolved", _display(pcell.value if pcell else None))
            continue
        ucell = cells.get(plan.unit_col) if plan.unit_col else None
        row_unit = _text(ucell)
        for c in stream_cols:
            cell = cells.get(c.col)
            if not _is_numeric(cell):
                continue
            assert cell is not None
            hdr_unit = unit_from_label(c.name)[1] or unit_from_label(c.bottom)[1]
            unit = row_unit or hdr_unit
            rd.add(
                key=("col", c.col),
                label=c.name,
                raw_id=make_raw_id(rd.sheet.name, plan.header_row, c.col),
                unit_hint=hdr_unit,
                cell=cell,
                unit=unit,
                period=period,
                context=_display(pcell.value if pcell else None),
            )


def _classify(label: str, bottom: str, title: str) -> MapResult:
    res = match_label(label, title)
    if res.status != "mapped" and bottom and bottom != label:
        alt = match_label(bottom, title)
        if alt.status == "mapped":
            return alt
    return res


def parse_tables(
    wb: Workbook, shapes: list[TableShape], ctx: TabularContext | None = None
) -> TabularResult:
    """Read the data cells of the given tables.

    Labels the Rules_Mapper places come back as ``MappedLabel``. Ambiguous and
    unknown labels come back as ``LabelItem`` for the Mapper_Agent. A table with no
    data cells yields nothing.
    """
    ctx = ctx or TabularContext()
    result = TabularResult()
    for shape in shapes:
        sheet = wb.sheet(shape.sheet)
        if sheet is None:
            continue
        if shape._plan is None:
            fresh = _analyze(sheet)
            if fresh is None:
                continue
            shape = fresh
        plan = shape._plan
        assert plan is not None
        by_row = _rows(sheet)
        rd = _Reader(wb, ctx, shape, sheet)
        if plan.layout == "long":
            _read_long(rd, plan, by_row)
        elif plan.layout == "periods_in_columns":
            _read_periods_in_columns(rd, plan, by_row)
        else:
            _read_periods_in_rows(rd, plan, by_row)

        bottoms = {c.col: c.bottom for c in plan.cols}
        for key, g in rd.groups.items():
            if not g.cells:
                continue
            bottom = bottoms.get(key[1], "") if key[0] == "col" else ""
            res = _classify(g.label, bottom, shape.title)
            base = dict(
                raw_id=g.raw_id,
                label=g.label,
                sheet=shape.sheet,
                title=shape.title,
                unit_hint=g.unit_hint,
                cells=g.cells,
            )
            if res.status == "mapped" and res.stream is not None and res.rule is not None:
                result.mapped.append(MappedLabel(**base, stream=res.stream, rule=res.rule))
            else:
                result.unmapped.append(LabelItem(**base))
        result.skipped.extend(rd.skipped)
        result.warnings.extend(rd.warnings)
    return result
