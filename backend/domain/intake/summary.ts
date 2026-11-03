/**
 * Summary-total extraction for spreadsheets (assisted, human-approved).
 *
 * Two kinds of candidate, both proposed and never written here:
 *
 * - `total_row`: the file has a total row (labelled Total, Sum or Grand total with
 *   numbers, or a SUM / SUBTOTAL(9) formula). The stored total is checked against
 *   the sum of the rows above it.
 * - `computed`: the file has no total row. The table is found (a header row, then
 *   the numbers beneath it), and each additive column is summed here. The
 *   columns are named by their headers. Rate, ratio, percentage, quality and
 *   identifier columns are not summed, and the candidate says which ones.
 *
 * An auditor approves each draft. Only approved drafts reach the Facts Ledger.
 *
 * Trust rules:
 * - A stored total is never replaced silently. Where it disagrees with the rows,
 *   the draft says so.
 * - A rounding allowance applies only when the numbers carry decimals.
 * - A formula whose result was never stored is reported as `not_stored`, and the
 *   recomputed sum is offered.
 */

import type { XlsxCell, XlsxSheet } from "./xlsx";
import { parseUnit } from "../units";

export type TotalKind = "keyword" | "formula" | "both";
export type DraftStatus =
  | "matches"
  | "rounding"
  | "differs"
  | "not_stored"
  | "not_recomputable"
  | "computed";

export interface TagTarget {
  path: string;
  label: string;
}

export interface SummaryDraft {
  col: number;
  /** The workbook total cell (e.g. "B36"), or the range summed when the file has no total row (e.g. "B6:B35"). */
  cellRef: string;
  /** The column's header, which becomes the metric name unless the auditor changes it. */
  header: string;
  /** Pre-filled metric tag. A suggestion; the auditor sets the final one. */
  suggestedFieldPath: string;
  tagBasis: "pack_target" | "header";
  /** Unit from the header's last bracketed group, e.g. "(t)". Null when not recognised. */
  suggestedUnit: string | null;
  /** Numbers summed in this column. */
  dataCount: number;
  /** Value stored in the workbook for the total cell. Null when there is no total cell. */
  cachedValue: number | null;
  formula: string | null;
  /** Sum computed here. */
  recomputed: number | null;
  recomputedFrom: string | null;
  /** cachedValue − recomputed, when both exist. */
  difference: number | null;
  status: DraftStatus;
  /** What to pre-fill: the workbook's total, or the recomputed sum when the workbook has none. */
  preferredValue: number | null;
  preferredSource: "cached" | "recomputed" | null;
}

export interface SummaryCandidate {
  /** Stable id: "total:36" for a total row in the file, "block:6-35" for totals computed here. */
  key: string;
  sheet: string;
  source: "total_row" | "computed";
  /** Null for a computed candidate. */
  totalRow: number | null;
  totalLabel: string | null;
  totalKind: TotalKind | null;
  /** Null when no header row was found. */
  headerRow: number | null;
  /** Count of rows summed. */
  dataRowCount: number;
  firstDataRow: number | null;
  lastDataRow: number | null;
  /** Period covered, read from a date column when one exists. A monthly total is not an annual figure. */
  coverage: { rows: number; first: string | null; last: string | null } | null;
  drafts: SummaryDraft[];
  notes: string[];
}

export interface ScanOptions {
  targets?: readonly TagTarget[];
}

const TOTAL_LABEL = /^\s*(grand\s+total|sub\s*-?\s*total|total|sum|overall\s+total)\s*:?\s*$/i;
const SUM_FORMULA = /^\s*(SUM|SUBTOTAL)\s*\((.*)\)\s*$/i;
const SINGLE_RANGE = /^\s*\$?([A-Z]{1,3})\$?(\d+)\s*:\s*\$?([A-Z]{1,3})\$?(\d+)\s*$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;
const STOP = new Set(["of", "the", "and", "in", "per", "total", "sum", "a", "an", "to", "for"]);

/** Headers naming a rate, ratio, percentage or quality value. Summing these is meaningless. */
const RATE_WORDS =
  /\b(rate|ratio|factor|percent|average|avg|mean|temperature|price|grade|gcv|ncv|calorific|ash|moisture|hydrogen|efficiency|per)\b/i;
/** Headers naming a date, a serial number or an identifier. */
const IDENTIFIER_WORDS = /\b(date|time|day|month|year|s\.?\s*no\.?|sr\.?\s*no\.?|serial|index|id|lot|no)\b/i;

/** Column letters for a 1-based column number: 1 → A, 28 → AB. */
export function columnLetters(n: number): string {
  let s = "";
  let x = n;
  while (x > 0) {
    const r = (x - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
}

function columnNumber(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

function roundTo(n: number, places: number): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

function decimalPlaces(n: number): number {
  if (!Number.isFinite(n)) return 0;
  const s = String(n);
  const e = s.indexOf("e-");
  if (e >= 0) {
    const mantissa = s.slice(0, e);
    const dot = mantissa.indexOf(".");
    return Number(s.slice(e + 2)) + (dot < 0 ? 0 : mantissa.length - dot - 1);
  }
  const dot = s.indexOf(".");
  return dot < 0 ? 0 : s.length - dot - 1;
}

function isNum(c: XlsxCell | undefined): c is XlsxCell & { value: number } {
  return !!c && typeof c.value === "number" && Number.isFinite(c.value);
}

function isText(c: XlsxCell | undefined): c is XlsxCell & { value: string } {
  return !!c && typeof c.value === "string" && c.value.trim() !== "";
}

interface Grid {
  byRow: Map<number, Map<number, XlsxCell>>;
  at(row: number, col: number): XlsxCell | undefined;
  rows: number[];
}

function buildGrid(sheet: XlsxSheet): Grid {
  const byRow = new Map<number, Map<number, XlsxCell>>();
  for (const c of sheet.cells) {
    let row = byRow.get(c.row);
    if (!row) {
      row = new Map();
      byRow.set(c.row, row);
    }
    row.set(c.col, c);
  }
  return {
    byRow,
    at: (row, col) => byRow.get(row)?.get(col),
    rows: [...byRow.keys()].sort((a, b) => a - b),
  };
}

function rowHasNumber(g: Grid, r: number): boolean {
  const cells = g.byRow.get(r);
  if (!cells) return false;
  for (const c of cells.values()) if (isNum(c)) return true;
  return false;
}

function totalInfo(cells: Map<number, XlsxCell>): { kind: TotalKind; label: string | null } | null {
  const ordered = [...cells.entries()].sort(([a], [b]) => a - b).map(([, c]) => c);
  if (!ordered.some(isNum)) return null;
  const labelCell = ordered.find(isText);
  const keyword = !!labelCell && TOTAL_LABEL.test(labelCell.value);
  const formula = ordered.some((c) => !!c.formula && SUM_FORMULA.test(c.formula));
  if (!keyword && !formula) return null;
  return {
    kind: keyword && formula ? "both" : keyword ? "keyword" : "formula",
    label: labelCell ? labelCell.value : null,
  };
}

/** The nearest row above a total row that holds text headers and no numbers. */
function findHeaderAboveTotal(g: Grid, totalRow: number): number | null {
  for (let r = totalRow - 1; r >= 1; r--) {
    const cells = g.byRow.get(r);
    if (!cells || cells.size === 0) continue;
    const vals = [...cells.values()];
    if (!vals.some(isNum) && vals.filter(isText).length >= 2) return r;
  }
  return null;
}

/** Coverage from a date column: the column where most of these rows hold ISO dates. */
function coverageFor(g: Grid, rows: number[]): SummaryCandidate["coverage"] {
  if (rows.length === 0) return null;
  const colsWithDates = new Map<number, string[]>();
  for (const r of rows) {
    for (const [col, cell] of g.byRow.get(r) ?? []) {
      if (isText(cell) && ISO_DATE.test(cell.value)) {
        const list = colsWithDates.get(col) ?? [];
        list.push(cell.value);
        colsWithDates.set(col, list);
      }
    }
  }
  let best: string[] | null = null;
  for (const list of colsWithDates.values()) {
    if (list.length >= rows.length * 0.8 && (!best || list.length > best.length)) best = list;
  }
  if (!best) return null;
  const sorted = [...best].sort();
  return { rows: best.length, first: sorted[0] ?? null, last: sorted[sorted.length - 1] ?? null };
}

/** Unit from the last bracketed group of a header, e.g. "Clinker Production (t)" → "t". */
export function unitFromHeader(header: string): string | null {
  const m = /\(([^()]+)\)\s*$/.exec(header.trim());
  if (!m) return null;
  return parseUnit(m[1]!) ?? null;
}

/** Why a column must not be summed, or null when it may be. */
function notSummableReason(label: string): string | null {
  const unit = /\(([^()]*)\)\s*$/.exec(label)?.[1] ?? "";
  if (unit.includes("/") || label.includes("%") || RATE_WORDS.test(label)) return "a rate, ratio or quality value";
  if (IDENTIFIER_WORDS.test(label)) return "a date, serial number or identifier";
  return null;
}

/**
 * Suggest a metric tag for a column header. A pack target wins when most of its
 * label's words appear in the header. Otherwise the header's own words become the tag.
 */
export function suggestFieldPath(
  header: string,
  targets: readonly TagTarget[] = []
): { fieldPath: string; basis: "pack_target" | "header" } {
  const tokens = (s: string) =>
    s
      .toLowerCase()
      .replace(/\([^)]*\)/g, " ")
      .split(/[^a-z0-9]+/)
      .filter((t) => t && !STOP.has(t));
  const headerTokens = new Set(tokens(header));
  let best: { path: string; score: number } | null = null;
  for (const t of targets) {
    const words = tokens(t.label);
    if (words.length === 0) continue;
    const shared = words.filter((w) => headerTokens.has(w)).length;
    const score = shared / words.length;
    if (shared >= 1 && score >= 0.6 && (!best || score > best.score)) best = { path: t.path, score };
  }
  if (best) return { fieldPath: best.path, basis: "pack_target" };
  const slug = tokens(header).join("_");
  return { fieldPath: slug || "value", basis: "header" };
}

/** A candidate for a total row the file already has: the stored total against the rows above. */
function buildTotalCandidate(
  sheetName: string,
  g: Grid,
  total: { row: number; kind: TotalKind; label: string | null },
  allTotalRows: ReadonlySet<number>,
  opts: ScanOptions
): SummaryCandidate {
  const T = total.row;
  const notes: string[] = [];
  const headerRow = findHeaderAboveTotal(g, T);
  if (headerRow === null) notes.push(`No header row found above row ${T}. Columns are named by letter.`);

  const dataRowNumbers: number[] = [];
  for (let r = headerRow ?? 1; r < T; r++) {
    if (allTotalRows.has(r)) continue;
    if (headerRow !== null && r === headerRow) continue;
    if (rowHasNumber(g, r)) dataRowNumbers.push(r);
  }
  if (allTotalRows.size > 1) {
    notes.push(`${allTotalRows.size} total rows on this sheet. This candidate is row ${T}; other total rows are not summed into it.`);
  }
  const coverage = coverageFor(g, dataRowNumbers);

  const drafts: SummaryDraft[] = [];
  const totalCells = g.byRow.get(T) ?? new Map<number, XlsxCell>();
  for (const [col, totalCell] of [...totalCells.entries()].sort(([a], [b]) => a - b)) {
    if (!isNum(totalCell) && !totalCell.formula) continue;
    const header = headerRow !== null ? g.at(headerRow, col) : undefined;
    if (headerRow !== null && !isText(header)) continue;
    const label = isText(header) ? header.value : `Column ${columnLetters(col)}`;

    const dataVals = dataRowNumbers
      .map((r) => g.at(r, col))
      .filter(isNum)
      .map((c) => c.value);

    // Recompute: a simple SUM/SUBTOTAL(9) range over this column when the formula has one,
    // otherwise the numbers above the total in this column.
    let recomputed: number | null = null;
    let recomputedFrom: string | null = null;
    if (totalCell.formula) {
      const m = SUM_FORMULA.exec(totalCell.formula);
      if (m) {
        let args: string | null = m[2]!;
        if (m[1]!.toUpperCase() === "SUBTOTAL") {
          const comma = args.indexOf(",");
          const code = comma < 0 ? NaN : Number(args.slice(0, comma).trim());
          args = code === 9 || code === 109 ? args.slice(comma + 1) : null;
        }
        const rm = args ? SINGLE_RANGE.exec(args) : null;
        if (rm) {
          const c1 = columnNumber(rm[1]!);
          const c2 = columnNumber(rm[3]!);
          const r1 = Math.min(Number(rm[2]), Number(rm[4]));
          const r2 = Math.max(Number(rm[2]), Number(rm[4]));
          if (c1 === c2 && c1 === col) {
            let sum = 0;
            let n = 0;
            for (let r = r1; r <= r2; r++) {
              const cell = g.at(r, col);
              if (isNum(cell)) {
                sum += cell.value;
                n++;
              }
            }
            recomputed = roundTo(sum, 9);
            recomputedFrom = `${columnLetters(col)}${r1}:${columnLetters(col)}${r2} (${n} numbers)`;
          }
        }
      }
      if (recomputed === null) {
        notes.push(`The total in ${columnLetters(col)}${T} is a formula this reader does not recompute; the data rows were summed instead.`);
      }
    }
    if (recomputed === null && dataVals.length > 0) {
      recomputed = roundTo(dataVals.reduce((a, b) => a + b, 0), 9);
      recomputedFrom = `${dataVals.length} data rows above`;
    }

    const cachedValue = isNum(totalCell) ? totalCell.value : null;
    let decimals = cachedValue !== null ? decimalPlaces(cachedValue) : 0;
    for (const v of dataVals) decimals = Math.max(decimals, decimalPlaces(v));
    // Each rounded source value can be off by half a unit of its last decimal, and so can the total.
    const allowance = decimals >= 1 ? (dataVals.length + 1) * 0.5 * 10 ** -decimals : 0;

    let status: DraftStatus;
    let difference: number | null = null;
    if (recomputed === null) {
      status = "not_recomputable";
    } else if (cachedValue === null || (totalCell.formula && cachedValue === 0 && recomputed !== 0)) {
      status = "not_stored";
    } else {
      difference = roundTo(cachedValue - recomputed, 9);
      if (Math.abs(difference) < 1e-9) status = "matches";
      else if (decimals >= 1 && Math.abs(difference) <= allowance) status = "rounding";
      else status = "differs";
    }

    let preferredValue: number | null;
    let preferredSource: SummaryDraft["preferredSource"];
    if (status === "not_stored" && recomputed !== null) {
      preferredValue = recomputed;
      preferredSource = "recomputed";
    } else if (cachedValue !== null) {
      preferredValue = cachedValue;
      preferredSource = "cached";
    } else if (recomputed !== null) {
      preferredValue = recomputed;
      preferredSource = "recomputed";
    } else {
      preferredValue = null;
      preferredSource = null;
    }

    const tag =
      headerRow !== null
        ? suggestFieldPath(label, opts.targets ?? [])
        : { fieldPath: `column_${columnLetters(col).toLowerCase()}`, basis: "header" as const };

    drafts.push({
      col,
      cellRef: `${columnLetters(col)}${T}`,
      header: label,
      suggestedFieldPath: tag.fieldPath,
      tagBasis: tag.basis,
      suggestedUnit: headerRow !== null ? unitFromHeader(label) : null,
      dataCount: dataVals.length,
      cachedValue,
      formula: totalCell.formula ?? null,
      recomputed,
      recomputedFrom,
      difference,
      status,
      preferredValue,
      preferredSource,
    });
  }

  if (drafts.some((d) => d.status === "differs")) {
    notes.push("Some totals differ from the sum of their rows by more than rounding. Check them before approving.");
  }
  if (drafts.some((d) => d.status === "not_stored")) {
    notes.push("Some totals are formulas whose result was not stored in the file. The recomputed sum is offered for those.");
  }

  return {
    key: `total:${T}`,
    sheet: sheetName,
    source: "total_row",
    totalRow: T,
    totalLabel: total.label,
    totalKind: total.kind,
    headerRow,
    dataRowCount: dataRowNumbers.length,
    firstDataRow: dataRowNumbers[0] ?? null,
    lastDataRow: dataRowNumbers[dataRowNumbers.length - 1] ?? null,
    coverage,
    drafts,
    notes,
  };
}

/**
 * Totals computed here, for a sheet with no total row. The table is the first block
 * under a header row: the numbers beneath it, blank rows allowed, ending at the first
 * row with no numbers. Without a header row there are no column names, so nothing is
 * offered and the auditor maps cells instead.
 */
function buildComputedCandidate(sheetName: string, g: Grid, opts: ScanOptions): SummaryCandidate | null {
  const numericRows = g.rows.filter((r) => rowHasNumber(g, r));
  if (numericRows.length === 0) return null;
  const first = numericRows[0]!;

  let headerRow: number | null = null;
  for (let r = first - 1; r >= 1; r--) {
    const cells = g.byRow.get(r);
    if (!cells) continue;
    const vals = [...cells.values()];
    if (vals.some(isNum)) break;
    if (vals.filter(isText).length >= 2) {
      headerRow = r;
      break;
    }
  }
  if (headerRow === null) return null;

  const maxRow = g.rows[g.rows.length - 1]!;
  const blockRows: number[] = [];
  for (let r = first; r <= maxRow; r++) {
    if (!g.byRow.has(r)) continue;
    if (rowHasNumber(g, r)) blockRows.push(r);
    else break;
  }
  const lastRow = blockRows[blockRows.length - 1]!;

  const notes: string[] = [
    `No total row in this file. The totals below were summed here from rows ${first} to ${lastRow}.`,
  ];
  if (numericRows.some((r) => r > lastRow)) {
    notes.push(`Rows below ${lastRow} that hold numbers are not part of this table, so they were not summed.`);
  }

  const coverage = coverageFor(g, blockRows);
  const skipped: string[] = [];
  const drafts: SummaryDraft[] = [];
  const headerCells = [...(g.byRow.get(headerRow)?.entries() ?? [])].sort(([a], [b]) => a - b);
  for (const [col, cell] of headerCells) {
    if (!isText(cell)) continue;
    const label = cell.value;
    const values = blockRows
      .map((r) => g.at(r, col))
      .filter(isNum)
      .map((c) => c.value);
    if (values.length === 0) continue;
    const reason = notSummableReason(label);
    if (reason) {
      skipped.push(`${label} (${reason})`);
      continue;
    }
    const recomputed = roundTo(values.reduce((a, b) => a + b, 0), 9);
    const tag = suggestFieldPath(label, opts.targets ?? []);
    drafts.push({
      col,
      cellRef: `${columnLetters(col)}${first}:${columnLetters(col)}${lastRow}`,
      header: label,
      suggestedFieldPath: tag.fieldPath,
      tagBasis: tag.basis,
      suggestedUnit: unitFromHeader(label),
      dataCount: values.length,
      cachedValue: null,
      formula: null,
      recomputed,
      recomputedFrom: `rows ${first} to ${lastRow}: ${values.length} number(s)`,
      difference: null,
      status: "computed",
      preferredValue: recomputed,
      preferredSource: "recomputed",
    });
  }

  if (skipped.length > 0) {
    notes.push(`Not summed: ${skipped.join("; ")}. Rates, percentages, quality values and identifiers are not totals.`);
  }
  if (drafts.length === 0 && skipped.length === 0) return null;

  return {
    key: `block:${first}-${lastRow}`,
    sheet: sheetName,
    source: "computed",
    totalRow: null,
    totalLabel: null,
    totalKind: null,
    headerRow,
    dataRowCount: blockRows.length,
    firstDataRow: first,
    lastDataRow: lastRow,
    coverage,
    drafts,
    notes,
  };
}

/**
 * Totals for a sheet. A sheet with total rows gets one candidate per total row. A
 * sheet without any gets one computed candidate, when its table has a header row and
 * numbers. A sheet with neither returns [].
 */
export function scanSheetForSummaries(sheet: XlsxSheet, opts: ScanOptions = {}): SummaryCandidate[] {
  const g = buildGrid(sheet);
  const totals: { row: number; kind: TotalKind; label: string | null }[] = [];
  for (const r of g.rows) {
    const info = totalInfo(g.byRow.get(r)!);
    if (info) totals.push({ row: r, ...info });
  }
  if (totals.length > 0) {
    const allTotalRows = new Set(totals.map((t) => t.row));
    return totals.map((t) => buildTotalCandidate(sheet.name, g, t, allTotalRows, opts));
  }
  const computed = buildComputedCandidate(sheet.name, g, opts);
  return computed ? [computed] : [];
}

/** The compact form kept with each spreadsheet when it is uploaded. */
export function summaryHeadline(candidates: readonly SummaryCandidate[]): {
  totals: number;
  candidates: { key: string; source: SummaryCandidate["source"]; headerRow: number | null; dataRowCount: number; drafts: number }[];
} {
  return {
    totals: candidates.filter((c) => c.source === "total_row").length,
    candidates: candidates.map((c) => ({
      key: c.key,
      source: c.source,
      headerRow: c.headerRow,
      dataRowCount: c.dataRowCount,
      drafts: c.drafts.length,
    })),
  };
}
