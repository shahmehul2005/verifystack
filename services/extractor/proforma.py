"""Pro_Forma_Parser: label-anchored reading of the Form-Sb pro forma workbook.

The parser finds each target value by matching a regex against cell labels. No
cell address appears in this module (Requirement 6.1), so rows and columns can
move between workbook versions.

For every target the parser:

1. Scans the text cells of the given sheets, row by row and left to right, for a
   label that matches the target regex and not its exclusion regex. The unit in
   parentheses, such as ``(Lakh t)``, is taken off the label first.
2. Looks up to ``HEADER_LOOKBACK`` rows above the label for a header row that has
   both a Baseline cell and a Current or Assessment cell. If it finds one, it reads
   the Current or Assessment column and never falls back to Baseline
   (Requirement 6.3). Otherwise it reads the nearest numeric cell to the right of
   the label (Requirement 6.2).
3. Reads the cached value of a formula cell. When there is no cached value, the
   ``FormulaEvaluator`` runs. A formula that cannot be evaluated gives no value
   and a warning that names the cell (Requirements 6.6 and 6.8).
4. Takes the unit from the label. Without a unit, the stream standard unit is used
   and the reading is flagged ``unit_assumed`` (Requirements 6.4 and 6.5).

Process coal and power coal are internal cells. When both exist, the parser emits
one derived ``coal_quantity`` reading with their sum (Requirement 6.10, decision
D5). A declared coal total is only a cross-check. The parser has no calcination
target and never multiplies clinker production by a constant (Requirement 6.11).
Factor rows such as emission factors match no target and are never emitted.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field
from datetime import date, datetime, time
from decimal import Decimal, InvalidOperation
from typing import Any

from .models import (
    BEEPATSectorStream,
    ExtractorWarning,
    Period,
    Provenance,
    Reading,
    SkippedItem,
    SourceType,
)
from .units import STANDARD_UNIT, convert, parse_number, unit_from_label
from .workbook import Cell, FormulaEvaluator, Sheet, Workbook

__all__ = [
    "BASELINE_HEADER",
    "COAL_MISMATCH_TOLERANCE",
    "CURRENT_HEADER",
    "HEADER_LOOKBACK",
    "TARGETS",
    "ParseContext",
    "ProformaResult",
    "ProformaTarget",
    "match_targets",
    "parse_proforma",
    "score_sheet",
]

_S = BEEPATSectorStream

# A relative difference above this between the derived coal total and a declared
# total adds ``coal_total_mismatch`` (design D5: 0.1%).
COAL_MISMATCH_TOLERANCE = Decimal("0.001")

# How many rows above a label the header search looks.
HEADER_LOOKBACK = 15

# Header wording for the two year columns. The real BEE Form-Sb workbook is not in
# the repository, so these patterns are an assumption and live in one place.
BASELINE_HEADER = re.compile(r"\b(?:baseline|base\s*year)\b", re.IGNORECASE)
CURRENT_HEADER = re.compile(r"\b(?:current|assessment|assess\.?\s*year)\b", re.IGNORECASE)

# A label longer than this is a banner or a note, not a row label.
_MAX_LABEL_CHARS = 120

# Relative difference above which two cells with the same label are reported.
_DUPLICATE_TOLERANCE = Decimal("0.001")


# ---------------------------------------------------------------------------
# Target table
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ProformaTarget:
    """One value the parser looks for, found by its label text.

    ``stream`` is ``None`` for internal cells (process coal, power coal and the
    declared coal total) that are never emitted as readings on their own.
    """

    stream: BEEPATSectorStream | None
    key: str
    label: re.Pattern[str]
    exclude: re.Pattern[str] | None = None

    @property
    def unit_stream(self) -> BEEPATSectorStream:
        """The stream whose standard unit applies to this target."""
        if self.stream is not None:
            return self.stream
        return _INTERNAL_UNIT_STREAM[self.key]


_INTERNAL_UNIT_STREAM: dict[str, BEEPATSectorStream] = {
    "coal_process": _S.COAL_QUANTITY,
    "coal_power": _S.COAL_QUANTITY,
    "coal_total": _S.COAL_QUANTITY,
}


def _rx(pattern: str) -> re.Pattern[str]:
    return re.compile(pattern, re.IGNORECASE)


# Words that mark a row as a factor, an energy figure, a rate or an emission, not
# a plain quantity. They keep rows such as "Coal Energy (TJ)" or "EF Coal" out of
# the quantity targets.
_NOT_A_QUANTITY = (
    r"\b(?:gcv|ncv|calorific|heat\s*rate|sec|factor|ef|emissions?|ghg|energy|tj"
    r"|co2e?|tco2e?)\b"
)
_NOT_A_GCV = r"\b(?:ncv|factor|ef|emissions?|ghg|energy|tj)\b"
_CONSUMED = r"[^|]*?\bconsum\w*\b"


def _quantity(
    stream: BEEPATSectorStream, key: str, subject: str, extra_exclude: str = ""
) -> ProformaTarget:
    """A "<fuel> consumed" row."""
    exclude = _NOT_A_QUANTITY + (f"|{extra_exclude}" if extra_exclude else "")
    return ProformaTarget(stream, key, _rx(rf"\b(?:{subject})\b{_CONSUMED}"), _rx(exclude))


def _gcv(
    stream: BEEPATSectorStream, key: str, subject: str, extra_exclude: str = ""
) -> ProformaTarget:
    """A "GCV of <fuel>" or "<fuel> GCV" row."""
    gcv = r"(?:gcv|gross\s+calorific\s+value)"
    pattern = rf"\b{gcv}\b[^|]*?\b(?:{subject})\b|\b(?:{subject})\b[^|]*?\b{gcv}\b"
    exclude = _NOT_A_GCV + (f"|{extra_exclude}" if extra_exclude else "")
    return ProformaTarget(stream, key, _rx(pattern), _rx(exclude))


_OTHER_COAL = r"\b(?:imported?|pet\s*coke|petcoke)\b"
_OTHER_FUEL_FOR_COAL = r"\b(?:imported?|pet\s*coke|petcoke|fuel\s+oil|furnace\s+oil)\b"

TARGETS: tuple[ProformaTarget, ...] = (
    # Production
    ProformaTarget(
        _S.EQUIVALENT_PRODUCT,
        "equivalent_product",
        _rx(r"\btotal\s+equivalent\b[^|]*?\bproduct\b"),
        _rx(r"\b(?:specific|sec|ghg|emissions?)\b"),
    ),
    ProformaTarget(
        _S.CLINKER_PRODUCTION,
        "clinker_production",
        _rx(r"\bclinker\s+(?:production|produced)\b"),
        _rx(r"\b(?:factor|export(?:ed)?|import(?:ed)?|sec|energy|notional)\b"),
    ),
    ProformaTarget(
        _S.OPC_PRODUCTION,
        "opc_production",
        _rx(r"\bopc\s+(?:production|produced)\b"),
        _rx(r"\bfactor\b"),
    ),
    ProformaTarget(
        _S.PPC_PRODUCTION,
        "ppc_production",
        _rx(r"\bppc\s+(?:production|produced)\b"),
        _rx(r"\bfactor\b"),
    ),
    ProformaTarget(
        _S.PSC_PRODUCTION,
        "psc_production",
        _rx(r"\b(?:psc|pcc)\s+(?:production|produced)\b"),
        _rx(r"\bfactor\b"),
    ),
    # Coal quantity is built from two internal cells and an optional declared total.
    ProformaTarget(
        None,
        "coal_process",
        _rx(rf"\bcoal\b{_CONSUMED}[^|]*?\bprocess\b"),
        _rx(f"{_NOT_A_QUANTITY}|{_OTHER_COAL}|\\btotal\\b"),
    ),
    ProformaTarget(
        None,
        "coal_power",
        _rx(rf"\bcoal\b{_CONSUMED}[^|]*?\bpower\b"),
        _rx(f"{_NOT_A_QUANTITY}|{_OTHER_COAL}|\\btotal\\b"),
    ),
    ProformaTarget(
        None,
        "coal_total",
        _rx(rf"\bcoal\b{_CONSUMED}[^|]*?\btotal\b|\btotal\b[^|]*?\bcoal\b{_CONSUMED}"),
        _rx(f"{_NOT_A_QUANTITY}|{_OTHER_COAL}"),
    ),
    _gcv(_S.COAL_GCV, "coal_gcv", r"coal", _OTHER_FUEL_FOR_COAL),
    # Other solid fuels
    _quantity(_S.PETCOKE_QUANTITY, "petcoke_quantity", r"pet\s*coke|petcoke"),
    _gcv(_S.PETCOKE_GCV, "petcoke_gcv", r"pet\s*coke|petcoke"),
    _quantity(_S.IMPORTED_COAL_QUANTITY, "imported_coal_quantity", r"imported\s+coal"),
    _gcv(_S.IMPORTED_COAL_GCV, "imported_coal_gcv", r"imported\s+coal"),
    _quantity(
        _S.BIOMASS_AFR_QUANTITY,
        "biomass_afr_quantity",
        r"biomass|afr|alternative\s+fuels?|alternate\s+fuels?",
    ),
    _gcv(
        _S.BIOMASS_AFR_GCV,
        "biomass_afr_gcv",
        r"biomass|afr|alternative\s+fuels?|alternate\s+fuels?",
    ),
    # Liquid fuels
    _quantity(_S.FO_QUANTITY, "fo_quantity", r"(?:fuel|furnace)\s+oil"),
    _gcv(_S.FO_GCV, "fo_gcv", r"(?:fuel|furnace)\s+oil"),
    _quantity(_S.HSD_QUANTITY, "hsd_quantity", r"hsd|diesel|high\s+speed\s+diesel"),
    _gcv(_S.HSD_GCV, "hsd_gcv", r"hsd|diesel|high\s+speed\s+diesel"),
    # Gaseous fuels
    _quantity(_S.NATURAL_GAS_QUANTITY, "natural_gas_quantity", r"natural\s+gas|png|lng"),
    _gcv(_S.NATURAL_GAS_GCV, "natural_gas_gcv", r"natural\s+gas|png|lng"),
    # Electricity
    ProformaTarget(
        _S.GRID_ELECTRICITY,
        "grid_electricity",
        _rx(
            r"\b(?:import(?:ed)?\s+from\s+(?:the\s+)?grid|grid\s+import"
            r"|purchased?\s+(?:power|electricity)|(?:power|electricity)\s+purchased?"
            r"|grid\s+(?:electricity|power))\b"
        ),
        _rx(f"{_NOT_A_QUANTITY}|\\bexport"),
    ),
    ProformaTarget(
        _S.POWER_EXPORT,
        "power_export",
        _rx(
            r"\b(?:export(?:ed)?\s+to\s+(?:the\s+)?grid|(?:power|electricity)\s+export(?:ed)?"
            r"|export(?:ed)?\s+(?:power|electricity))\b"
        ),
        _rx(_NOT_A_QUANTITY),
    ),
    ProformaTarget(
        _S.CPP_GENERATION,
        "cpp_generation",
        _rx(r"\b(?:cpp|captive\s+power(?:\s+plant)?)\s+(?:power|generation|generated)\b"),
        _rx(_NOT_A_QUANTITY),
    ),
    ProformaTarget(
        _S.WHRS_GENERATION,
        "whrs_generation",
        _rx(
            r"\b(?:whrs?|waste\s+heat\s+recovery(?:\s+system)?)\s+"
            r"(?:power|generation|generated)\b"
        ),
        _rx(_NOT_A_QUANTITY),
    ),
)

_TARGET_BY_KEY: dict[str, ProformaTarget] = {t.key: t for t in TARGETS}


# ---------------------------------------------------------------------------
# Result types
# ---------------------------------------------------------------------------


@dataclass
class ParseContext:
    """Optional shared state for a parse.

    Pass one ``FormulaEvaluator`` for the workbook to share its cache between
    parsers. When ``evaluator`` is ``None`` the parser builds its own.
    """

    evaluator: FormulaEvaluator | None = None


@dataclass
class ProformaResult:
    readings: list[Reading] = field(default_factory=list)
    skipped: list[SkippedItem] = field(default_factory=list)
    warnings: list[ExtractorWarning] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Label matching
# ---------------------------------------------------------------------------


def _clean_text(value: str) -> str:
    return re.sub(r"\s+", " ", unicodedata.normalize("NFKC", value)).strip()


def _clip(text: str, limit: int = 60) -> str:
    return text if len(text) <= limit else text[:limit] + "..."


def match_targets(label: str) -> list[ProformaTarget]:
    """Every target whose label regex matches ``label`` and whose exclusion does not.

    A trailing recognized unit such as ``(Lakh t)`` is removed before matching.
    """
    if not isinstance(label, str):
        return []
    text, _unit = unit_from_label(_clean_text(label))
    return [
        t
        for t in TARGETS
        if t.label.search(text) and not (t.exclude is not None and t.exclude.search(text))
    ]


def _label_cells(sheet: Sheet) -> list[Cell]:
    """Text cells that can be row labels, in reading order."""
    found: list[Cell] = []
    for key in sorted(sheet.cells):
        cell = sheet.cells[key]
        if not isinstance(cell.value, str) or cell.is_date:
            continue
        text = cell.value.strip()
        if not text or len(text) > _MAX_LABEL_CHARS:
            continue
        rng = sheet.merged_range_at(cell.row, cell.col)
        if rng is not None and rng.max_col > rng.min_col:
            continue  # a merged banner, not a row label
        found.append(cell)
    return found


def score_sheet(sheet: Sheet) -> int:
    """The number of distinct targets that have a matching label on ``sheet``.

    The pipeline treats a sheet with a score of 2 or more as a pro forma sheet.
    """
    keys: set[str] = set()
    for cell in _label_cells(sheet):
        matches = match_targets(str(cell.value))
        if len(matches) == 1:
            keys.add(matches[0].key)
    return len(keys)


# ---------------------------------------------------------------------------
# Number helpers
# ---------------------------------------------------------------------------


def _format_decimal(value: Decimal) -> str:
    text = format(value, "f")
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return "0" if text in ("", "-0") else text


def _plain_number(value: Any) -> Decimal | None:
    """The number held by a plain (non-formula) value, or ``None``."""
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float, Decimal)):
        try:
            number = Decimal(str(value))
        except InvalidOperation:
            return None
        return number if number.is_finite() else None
    if isinstance(value, str):
        return parse_number(value)
    return None


@dataclass(frozen=True)
class _CellValue:
    cell: Cell
    value: Decimal
    stated: str
    formula: str | None  # set only when the formula was evaluated


@dataclass(frozen=True)
class _Candidate:
    sheet: Sheet
    cell: Cell
    text: str  # the label as written, whitespace collapsed
    unit: str | None  # unit from the label parenthetical


@dataclass(frozen=True)
class _Norm:
    """A value in the standard unit of its stream."""

    value: Decimal
    unit: str
    assumed: bool


@dataclass(frozen=True)
class _Found:
    target: ProformaTarget
    cand: _Candidate
    cv: _CellValue
    norm: _Norm


# ---------------------------------------------------------------------------
# Parser
# ---------------------------------------------------------------------------


class _Parser:
    def __init__(self, wb: Workbook, ctx: ParseContext | None) -> None:
        self.wb = wb
        self.evaluator = (ctx.evaluator if ctx and ctx.evaluator else None) or FormulaEvaluator(wb)
        self.source = "csv" if wb.fmt == "csv" else "excel"
        self.result = ProformaResult()
        self._rows: dict[int, dict[int, list[Cell]]] = {}

    # ---- warnings ----

    def warn(self, code: str, message: str, raw_id: str | None = None) -> None:
        self.result.warnings.append(ExtractorWarning(code=code, message=message, raw_id=raw_id))

    # ---- candidates ----

    def collect(self, sheets: list[Sheet]) -> dict[str, list[_Candidate]]:
        by_key: dict[str, list[_Candidate]] = {}
        for sheet in sheets:
            for cell in _label_cells(sheet):
                text = _clean_text(str(cell.value))
                matches = match_targets(text)
                if not matches:
                    continue
                if len(matches) > 1:
                    self.warn(
                        "label_ambiguous",
                        f"Label {_clip(text)!r} matches more than one pro forma target "
                        "and was not read",
                        cell.raw_id,
                    )
                    continue
                _clean, unit = unit_from_label(text)
                by_key.setdefault(matches[0].key, []).append(_Candidate(sheet, cell, text, unit))
        return by_key

    # ---- header context ----

    def _row_cells(self, sheet: Sheet, row: int) -> list[Cell]:
        index = self._rows.get(id(sheet))
        if index is None:
            index = {}
            for (r, _c), cell in sorted(sheet.cells.items()):
                index.setdefault(r, []).append(cell)
            self._rows[id(sheet)] = index
        return index.get(row, [])

    def _header_columns(self, sheet: Sheet, row: int) -> tuple[set[int], set[int]]:
        """Columns headed Baseline and columns headed Current or Assessment on ``row``.

        A merged header counts for every column it spans.
        """
        texts: list[tuple[str, int, int]] = []  # text, first column, last column
        for cell in self._row_cells(sheet, row):
            if isinstance(cell.value, str):
                rng = sheet.merged_range_at(row, cell.col)
                texts.append(
                    (cell.value, rng.min_col, rng.max_col) if rng else (cell.value, cell.col, cell.col)
                )
        for rng in sheet.merged:
            if rng.min_row < row <= rng.max_row:  # the text sits above, in the same block
                top = sheet.cells.get((rng.min_row, rng.min_col))
                if top is not None and isinstance(top.value, str):
                    texts.append((top.value, rng.min_col, rng.max_col))
        baseline: set[int] = set()
        current: set[int] = set()
        for text, first, last in texts:
            is_base = bool(BASELINE_HEADER.search(text))
            is_current = bool(CURRENT_HEADER.search(text))
            if is_base and not is_current:
                baseline.update(range(first, last + 1))
            elif is_current and not is_base:
                current.update(range(first, last + 1))
        return baseline, current

    def _current_columns(self, sheet: Sheet, row: int) -> list[int] | None:
        """Current-year columns of the nearest header row above ``row``, if any."""
        for header_row in range(row - 1, max(0, row - HEADER_LOOKBACK - 1), -1):
            baseline, current = self._header_columns(sheet, header_row)
            if baseline and current:
                return sorted(current)
        return None

    # ---- reading one cell ----

    def _cell_value(self, cell: Cell, warn: bool) -> tuple[str, _CellValue | None]:
        """Read ``cell`` as a number.

        Returns ``("value", reading)``, ``("skip", None)`` for a cell that is not
        numeric (text, blank or a date) or ``("fail", None)`` for a formula that
        gave no value.
        """
        if cell.formula is not None:
            res = self.evaluator.evaluate_cell(cell.sheet, cell.row, cell.col)
            if res.value is None:
                if warn:
                    self.warn(
                        "formula_not_evaluated",
                        res.warning or f"{cell.raw_id}: formula gave no value",
                        cell.raw_id,
                    )
                return "fail", None
            formula = cell.formula if res.evaluated else None
            return "value", _CellValue(cell, res.value, _format_decimal(res.value), formula)
        if cell.is_date or isinstance(cell.value, (datetime, date, time)):
            return "skip", None
        number = _plain_number(cell.value)
        if number is None:
            return "skip", None
        stated = cell.value.strip() if isinstance(cell.value, str) else _format_decimal(number)
        return "value", _CellValue(cell, number, stated, None)

    def read(self, cand: _Candidate, warn: bool = True) -> _CellValue | None:
        """The value for one label, or ``None`` with a warning when there is none."""
        sheet, label = cand.sheet, cand.cell
        columns = self._current_columns(sheet, label.row)
        if columns is not None:
            ordered = [c for c in columns if c != label.col]
            for col in sorted(ordered, key=lambda c: (c < label.col, c)):
                cell = sheet.cells.get((label.row, col))
                if cell is None:
                    continue
                status, value = self._cell_value(cell, warn)
                if status == "value":
                    return value
                if status == "fail":
                    return None
            if warn:
                self.warn(
                    "current_value_missing",
                    f"{label.raw_id}: no value in the Current or Assessment-year column for "
                    f"{_clip(cand.text)!r}. The Baseline column is not used",
                    label.raw_id,
                )
            return None

        for cell in self._row_cells(sheet, label.row):
            if cell.col <= label.col:
                continue
            status, value = self._cell_value(cell, warn)
            if status == "value":
                return value
            if status == "fail":
                return None
        if warn:
            self.warn(
                "value_not_found",
                f"{label.raw_id}: no numeric cell to the right of {_clip(cand.text)!r}",
                label.raw_id,
            )
        return None

    # ---- units ----

    def normalize(self, target: ProformaTarget, cand: _Candidate, cv: _CellValue) -> _Norm | None:
        """``cv`` in the standard unit, or ``None`` when the unit cannot be converted."""
        stream = target.unit_stream
        standard = STANDARD_UNIT[stream]
        if cand.unit is None:
            return _Norm(cv.value, standard, True)
        converted = convert(cv.value, cand.unit, stream)
        if converted is None:
            return None
        return _Norm(converted, standard, False)

    # ---- building readings ----

    def _reading(
        self,
        stream: BEEPATSectorStream,
        label: str,
        cv: _CellValue,
        unit_as_stated: str | None,
        norm: _Norm,
        *,
        source_text: str,
        cell: Cell,
        derived: bool = False,
        reasons: list[str] | None = None,
    ) -> Reading:
        review = list(reasons or [])
        if norm.assumed and "unit_assumed" not in review:
            review.append("unit_assumed")
        return Reading(
            raw_id=cell.raw_id,
            label=label,
            stream_key=stream,
            period=Period(kind="annual", month_key="annual"),
            source_type=SourceType.PROFORMA,
            source=self.source,  # type: ignore[arg-type]
            value_as_stated=cv.stated,
            unit_as_stated=unit_as_stated,
            value=float(cv.value),
            normalized_value=float(norm.value),
            normalized_unit=norm.unit,
            verified=True,
            needs_review=bool(review),
            derived=derived,
            unit_assumed=norm.assumed,
            regulatory=False,
            mapping_source="proforma_label",
            confidence=1.0,
            review_reasons=review,
            provenance=Provenance(
                sheet=cell.sheet,
                cell=cell.ref,
                source_text=source_text,
                formula=cv.formula,
            ),
        )

    def _skip_unconvertible(self, target: ProformaTarget, cand: _Candidate, cv: _CellValue) -> None:
        standard = STANDARD_UNIT[target.unit_stream]
        self.result.skipped.append(
            SkippedItem(
                raw_id=cv.cell.raw_id,
                label=_clip(cand.text, 120),
                reason="not_convertible",
                detail=f"unit {cand.unit!r} cannot be converted to {standard}",
            )
        )

    def _source_text(self, cand: _Candidate, cv: _CellValue) -> str:
        return f"{_clip(cand.text, 120)} | {cv.stated}"

    # ---- duplicates ----

    def check_duplicates(self, found: _Found, others: list[_Candidate]) -> None:
        """Warn when a later cell with the same label holds a different value."""
        for other in others:
            cv = self.read(other, warn=False)
            if cv is None:
                continue
            norm = self.normalize(found.target, other, cv)
            if norm is None or norm.assumed != found.norm.assumed:
                continue
            base = found.norm.value
            diff = abs(norm.value - base)
            limit = _DUPLICATE_TOLERANCE * (abs(base) if base != 0 else Decimal(1))
            if diff > limit:
                self.warn(
                    "duplicate_label_differs",
                    f"{cv.cell.raw_id} repeats {_clip(other.text)!r} with a different value "
                    f"than {found.cv.cell.raw_id}. The first cell is used",
                    cv.cell.raw_id,
                )

    # ---- main ----

    def run(self, sheets: list[Sheet]) -> ProformaResult:
        by_key = self.collect(sheets)
        found: dict[str, _Found] = {}

        for target in TARGETS:
            cands = by_key.get(target.key, [])
            for i, cand in enumerate(cands):
                cv = self.read(cand)
                if cv is None:
                    continue
                norm = self.normalize(target, cand, cv)
                if norm is None:
                    self._skip_unconvertible(target, cand, cv)
                    continue
                hit = _Found(target, cand, cv, norm)
                found[target.key] = hit
                self.check_duplicates(hit, cands[i + 1 :])
                break

        for target in TARGETS:
            hit = found.get(target.key)
            if hit is None or target.stream is None:
                continue
            assert target.stream is not None
            self.result.readings.append(
                self._reading(
                    target.stream,
                    hit.cand.text,
                    hit.cv,
                    hit.cand.unit,
                    hit.norm,
                    source_text=self._source_text(hit.cand, hit.cv),
                    cell=hit.cv.cell,
                )
            )

        self._coal(found)
        return self.result

    # ---- coal total ----

    def _coal(self, found: dict[str, _Found]) -> None:
        process = found.get("coal_process")
        power = found.get("coal_power")
        declared = found.get("coal_total")

        if process is None and power is None:
            if declared is not None:
                # No halves to add up, so the declared total is the only coal figure.
                d = declared
                self.result.readings.append(
                    self._reading(
                        _S.COAL_QUANTITY,
                        d.cand.text,
                        d.cv,
                        d.cand.unit,
                        d.norm,
                        source_text=self._source_text(d.cand, d.cv),
                        cell=d.cv.cell,
                    )
                )
            return

        if process is None or power is None:
            have = process or power
            assert have is not None
            self.warn(
                "coal_total_not_derived",
                "Coal total not derived: only the "
                f"{'process' if process else 'power'} coal cell {have.cv.cell.raw_id} was found",
                have.cv.cell.raw_id,
            )
            return

        total = process.norm.value + power.norm.value
        assumed = process.norm.assumed or power.norm.assumed
        unit = STANDARD_UNIT[_S.COAL_QUANTITY]
        reasons: list[str] = []

        if declared is not None:
            expected = declared.norm.value
            base = abs(total) if total != 0 else Decimal(1)
            if abs(expected - total) / base > COAL_MISMATCH_TOLERANCE:
                reasons.append("coal_total_mismatch")
                self.warn(
                    "coal_total_mismatch",
                    f"Derived coal total {_format_decimal(total)} {unit} differs from the "
                    f"declared total {_format_decimal(expected)} {unit} in "
                    f"{declared.cv.cell.raw_id}",
                    process.cv.cell.raw_id,
                )

        source_text = (
            f"{_clip(process.cand.text, 80)} [{process.cv.cell.raw_id}] = "
            f"{_format_decimal(process.norm.value)} {unit} + "
            f"{_clip(power.cand.text, 80)} [{power.cv.cell.raw_id}] = "
            f"{_format_decimal(power.norm.value)} {unit}"
        )
        total_cv = _CellValue(process.cv.cell, total, _format_decimal(total), None)
        norm = _Norm(total, unit, assumed)
        self.result.readings.append(
            self._reading(
                _S.COAL_QUANTITY,
                "Coal consumed (process + power)",
                total_cv,
                unit,
                norm,
                source_text=source_text,
                cell=process.cv.cell,
                derived=True,
                reasons=reasons,
            )
        )


def parse_proforma(
    wb: Workbook, sheets: list[Sheet], ctx: ParseContext | None = None
) -> ProformaResult:
    """Read the pro forma targets from ``sheets`` of ``wb``.

    ``sheets`` are searched in the order given, and the first label that yields a
    value wins. Readings carry the real sheet name and cell of the value cell, no
    page, ``source_type="proforma"`` and an annual period.
    """
    return _Parser(wb, ctx).run(list(sheets))
