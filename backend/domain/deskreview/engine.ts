/**
 * Desk review: the cross-document rule engine.
 *
 * Two kinds of reading go in. Workbook readings are computed from the uploaded
 * spreadsheets by code (sums over dated rows, labelled pro forma cells with
 * formulas recomputed). PDF readings are entered by the auditor against the
 * source document, because the backend has no PDF reader and a model must not
 * produce a number a check depends on. Rules are code, one per cross-check, and
 * each lists the readings it needs. A rule with a missing reading is `pending`,
 * never silently passed. Nothing here writes a fact or feeds a run.
 */

import { parseXlsx, type XlsxSheet, type XlsxWorkbook } from "../intake/xlsx";
import type { CheckResult, CheckStatus } from "../crosscheck/tieout";
import { readProforma } from "../proforma/reader";
import type { ProformaInput } from "../proforma/types";

export type Reading = number | string;
export type Readings = Record<string, Reading>;

/** A figure the auditor reads off a PDF or a scan and types in, against its source slot. */
export interface ManualReadingSpec {
  key: string;
  label: string;
  unit: string;
  /** The evidence slot whose document holds the figure. */
  slot: string;
  /** `daily` keys are stored as `key@YYYY-MM-DD`, one per day. */
  kind?: "number" | "daily";
  hint?: string;
}

export interface DeskRule {
  id: string;
  section: string;
  label: string;
  /** Reading keys. `name@*` means at least one dated point of the series `name`. */
  needs: string[];
  evaluate(r: Readings): CheckResult;
}

export interface WorkbookReader {
  /** Evidence slot whose spreadsheets this reads. */
  slot: string;
  /** `note` reports rows the reader had to leave out, so the page can show them. */
  read(sheet: XlsxSheet, note?: (message: string) => void): Readings;
}

export interface DeskReviewDef {
  packId: string;
  /** Pro forma cells that rules compare against. The key is the reading key. */
  proformaCells: ProformaInput[];
  readers: WorkbookReader[];
  manual: ManualReadingSpec[];
  rules: DeskRule[];
  /** Evidence slot to the reading that counts the months its documents cover. Drives the completeness strip. */
  monthsEvidence?: Record<string, string>;
  /** The materiality position from the same readings the aggregate check used. Null when the readings are not there. */
  materiality?(r: Readings, outcomes: DeskOutcome[]): MaterialityPosition | null;
  /**
   * Extra readings from the pro forma workbook after labelled cells are stored.
   * Formula text is stored separately as `pf.formula@Sheet!REF`.
   */
  proformaAnnotations?(wb: XlsxWorkbook): Readings;
}

export interface MaterialityPosition {
  /** Total direct and indirect emissions the entity reported, tCO2e. */
  reportedTotal: number;
  /** The share of the reported total that counts as material, as a fraction. */
  fraction: number;
  /** `reportedTotal` times `fraction`. */
  threshold: number;
  /** The misstatements the checks could put a number on, summed. */
  quantified: number;
  /** Sources the aggregate could not count. Each one stops it passing. */
  limitations: string[];
}

export type DeskStatus = CheckStatus | "pending";

/** Where one reading came from: the document, and the cell, sheet or page inside it. */
export interface ReadingOrigin {
  slot: string;
  documentId: string | null;
  filename: string | null;
  /** `Sheet!B20` for a cell, a sheet name for a table, `p. 2` for a PDF page. */
  location: string | null;
  /** The label printed beside the figure in its own document, when there is one. */
  label?: string;
  /** Read from a workbook by code, or typed by an auditor against a PDF page. Absent on runs saved before this was recorded. */
  kind?: "workbook" | "typed" | "snip";
  /** When an auditor typed the figure. */
  enteredAt?: string;
  /** The box the auditor drew on the page, for a snipped figure. Normalised to the page. */
  region?: { x: number; y: number; width: number; height: number };
  /** What is printed in that box, as the auditor read it. */
  sourceText?: string;
}

/** One input of a check, with its value and where it was read from. */
export interface DeskSourceRef {
  key: string;
  label: string;
  value: Reading;
  unit?: string;
  slot?: string;
  documentId?: string | null;
  filename?: string | null;
  location?: string | null;
  kind?: "workbook" | "typed" | "snip";
  enteredAt?: string;
  region?: { x: number; y: number; width: number; height: number };
  sourceText?: string;
}

export interface DeskOutcome {
  id: string;
  section: string;
  label: string;
  status: DeskStatus;
  detail: string;
  actual?: number;
  expected?: number;
  diff?: number;
  thresholdSource?: string;
  /** Readings still needed, for a pending rule. */
  missing?: string[];
  /** The readings this check used, each with its document and location. Absent on runs saved before this was recorded. */
  sources?: DeskSourceRef[];
}

export const num = (r: Readings, k: string) => Number(r[k]);

/**
 * Infer the statutory evidence slot for a document from its explicit slot,
 * its classified doc_type, or its filename pattern.
 */
export function inferSlot(doc: { name?: string | null; slot?: string | null; docType?: string | null }): string | null {
  if (doc.slot) return doc.slot;
  if (doc.docType) {
    const MAP: Record<string, string> = {
      production_log: "production_evidence",
      cpp_generation_log: "cpp_generation",
      fuel_invoice: "coal_purchase",
      lab_certificate: "coal_quality",
      fuel_lab_log: "coal_quality",
      electricity_bill: "grid_electricity",
      proforma_workbook: "proforma_workbook",
      sampling_plan: "sampling_plan",
      data_flow_sop: "data_flow_sop",
      form1: "form1",
      re_undertaking: "re_undertaking",
      petcoke_log: "petcoke_log",
      rec_declaration: "rec_declaration",
      weighbridge_slip: "coal_purchase",
      scada_production_trend: "production_evidence",
      daily_production_report: "production_evidence",
      monthly_production_report: "production_evidence",
      sap_production_printout: "production_evidence",
      cpp_daily_generation: "cpp_generation",
      cpp_monthly_generation: "cpp_generation",
      coal_internal_lab: "coal_quality",
      coal_nabl_certificate: "coal_quality",
      coal_purchase_order: "coal_purchase",
      petcoke_consumption_log: "petcoke_log",
      grid_electricity_bill: "grid_electricity",
    };
    if (MAP[doc.docType]) return MAP[doc.docType];
  }
  const n = (doc.name ?? "").toLowerCase();
  if (/pro-?forma/i.test(n) || /15_sector/i.test(n)) return "proforma_workbook";
  if (/scada|mpr|daily.*prod|monthly.*prod|sap.*pp|0[1234]_/i.test(n)) return "production_evidence";
  if (/cpp.*daily|cpp.*monthly|cpp.*generation|0[67]_/i.test(n)) return "cpp_generation";
  if (/internal.*lab|nabl|coal.*quality|0[89]_/i.test(n)) return "coal_quality";
  if (/petcoke.*consumption|11_petcoke/i.test(n)) return "petcoke_log";
  if (/grid.*electricity|discom|electricity.*bill|12_grid/i.test(n)) return "grid_electricity";
  if (/coal.*purchase|10_coal/i.test(n)) return "coal_purchase";
  if (/rec.*certificate|renewable|13_rec/i.test(n)) return "rec_declaration";
  if (/form.*1|16_form/i.test(n)) return "form1";
  return null;
}

export function series(r: Readings, name: string): { date: string; value: Reading }[] {
  const p = `${name}@`;
  return Object.entries(r)
    .filter(([k]) => k.startsWith(p))
    .map(([k, value]) => ({ date: k.slice(p.length), value }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

const has = (r: Readings, k: string) => (k.endsWith("@*") ? series(r, k.slice(0, -2)).length > 0 : k in r);

/** The readings a rule used, with the document and location each came from. Missing readings are left out. */
function sourcesFor(def: DeskReviewDef, rule: DeskRule, readings: Readings, origins: Record<string, ReadingOrigin>): DeskSourceRef[] {
  const manual = new Map(def.manual.map((m) => [m.key, m]));
  const out: DeskSourceRef[] = [];
  for (const need of rule.needs) {
    const isSeries = need.endsWith("@*");
    const name = isSeries ? need.slice(0, -2) : need;
    const points = isSeries ? series(readings, name) : [];
    const key = isSeries ? (points[0] ? `${name}@${points[0].date}` : null) : need in readings ? need : null;
    if (key === null) continue;
    const origin = origins[key];
    const spec = manual.get(name);
    const cell = def.proformaCells.find((c) => c.fieldPath === name);
    out.push({
      key: need,
      label: spec?.label ?? origin?.label ?? name,
      value: isSeries ? `${points.length} dated reading${points.length === 1 ? "" : "s"}` : readings[key]!,
      ...(spec?.unit || cell?.unit ? { unit: (spec?.unit ?? cell?.unit) as string } : {}),
      ...(origin ? { slot: origin.slot, documentId: origin.documentId, filename: origin.filename, location: origin.location } : spec ? { slot: spec.slot } : {}),
      ...(origin?.kind ? { kind: origin.kind } : {}),
      ...(origin?.enteredAt ? { enteredAt: origin.enteredAt } : {}),
      ...(origin?.region ? { region: origin.region } : {}),
      ...(origin?.sourceText ? { sourceText: origin.sourceText } : {}),
    });
  }
  return out;
}

export function runDeskReview(def: DeskReviewDef, readings: Readings, origins: Record<string, ReadingOrigin> = {}): DeskOutcome[] {
  return def.rules.map((rule) => {
    const missing = rule.needs.filter((k) => !has(readings, k));
    const sources = sourcesFor(def, rule, readings, origins);
    const base = { id: rule.id, section: rule.section, label: rule.label, ...(sources.length > 0 ? { sources } : {}) };
    if (missing.length > 0) {
      return { ...base, status: "pending" as const, detail: "Waiting for readings.", missing };
    }
    try {
      const r = rule.evaluate(readings);
      return {
        ...base,
        status: r.status,
        detail: r.detail,
        ...(r.actual !== undefined ? { actual: r.actual } : {}),
        ...(r.expected !== undefined ? { expected: r.expected } : {}),
        ...(r.diff !== undefined ? { diff: r.diff } : {}),
        ...(r.thresholdSource ? { thresholdSource: r.thresholdSource } : {}),
      };
    } catch (e) {
      return { ...base, status: "not_applicable" as const, detail: `Could not evaluate: ${e instanceof Error ? e.message : String(e)}` };
    }
  });
}

export interface DeskWorkbook {
  slot: string;
  name: string;
  bytes: Uint8Array;
  /** The stored document, so a reading can link back to it. */
  documentId?: string;
}

const readingName = (key: string) => key.split("@")[0]!;
const sourceName = (o: ReadingOrigin) => [o.filename ?? o.slot, o.location].filter(Boolean).join(" · ");

/**
 * Writes readings into one map and remembers where each came from. When a
 * later file or sheet carries a key that an earlier one already set to a
 * different value, the later one still wins, as it always did, but the clash is
 * reported so the page can say which figures were replaced and by what.
 */
export function createReadingWriter(readings: Readings, origins: Record<string, ReadingOrigin>) {
  const clashes = new Map<string, { by: string; replaced: string; count: number; names: Set<string> }>();
  return {
    put(key: string, value: Reading, origin: ReadingOrigin) {
      const prev = origins[key];
      if (key in readings && prev && readings[key] !== value && (prev.filename !== origin.filename || prev.location !== origin.location)) {
        const id = `${sourceName(prev)}\u0000${sourceName(origin)}`;
        const c = clashes.get(id) ?? { by: sourceName(origin), replaced: sourceName(prev), count: 0, names: new Set<string>() };
        c.count += 1;
        c.names.add(readingName(key));
        clashes.set(id, c);
      }
      readings[key] = value;
      origins[key] = origin;
    },
    /** One sentence per pair of sources that clashed. */
    notes(): string[] {
      return [...clashes.values()].map((c) => {
        const names = [...c.names].slice(0, 3).join(", ");
        return `${c.by} replaced ${c.count} reading(s) already read from ${c.replaced} (${names}${c.names.size > 3 ? ", ..." : ""}). Only one source can stand: keep one file for this evidence, or check which is current.`;
      });
    },
  };
}

/** Workbook readings for every spreadsheet in a slot, the notes a reader leaves, and where each reading came from. */
export function readWorkbooks(
  def: DeskReviewDef,
  files: DeskWorkbook[],
  runInputs: readonly ProformaInput[]
): { readings: Readings; notes: string[]; origins: Record<string, ReadingOrigin> } {
  const readings: Readings = {};
  const notes = new Set<string>();
  const origins: Record<string, ReadingOrigin> = {};
  const writer = createReadingWriter(readings, origins);
  // A fixed order, so which file wins a clash does not depend on how the files were listed.
  const ordered = [...files].sort(
    (a, b) => a.slot.localeCompare(b.slot) || a.name.localeCompare(b.name) || (a.documentId ?? "").localeCompare(b.documentId ?? "")
  );
  for (const f of ordered) {
    const at = (location: string | null, label?: string): ReadingOrigin => ({
      slot: f.slot,
      documentId: f.documentId ?? null,
      filename: f.name,
      location,
      kind: "workbook",
      ...(label ? { label } : {}),
    });
    let wb: XlsxWorkbook;
    try {
      wb = parseXlsx(f.bytes);
    } catch {
      notes.add(`${f.name} could not be opened as a workbook.`);
      continue;
    }
    if (f.slot === "proforma_workbook") {
      const cells = readProforma(wb, def.proformaCells);
      for (const d of cells.drafts) {
        if (d.fieldPath && d.value !== null && (d.status === "found" || d.status === "zero")) {
          writer.put(d.fieldPath, d.value, at(d.sheet && d.cellRef ? `${d.sheet}!${d.cellRef.toUpperCase()}` : d.sheet, d.label));
        }
      }
      const unmapped = readProforma(wb, runInputs).drafts.filter((d) => d.status === "unmapped" && (d.value ?? 0) > 0);
      // Derived readings (counts, formula text, flags) belong to the workbook as a whole.
      writer.put("pf.unmapped_count", unmapped.length, at(null));
      writer.put("pf.unmapped_list", unmapped.map((d) => `${d.label} = ${d.workbookValue}`).join("; "), at(null));
      if (cells.staleFormulaCells > 0) {
        notes.add(`${f.name}: ${cells.staleFormulaCells} formula cell(s) stored a result that differs from the formula; values here are recomputed.`);
      }
      writer.put("pf.proforma_opened", 1, at(null));
      for (const sheet of wb.sheets) {
        for (const cell of sheet.cells) {
          if (!cell.formula) continue;
          writer.put(`pf.formula@${sheet.name}!${cell.ref.toUpperCase()}`, cell.formula, at(`${sheet.name}!${cell.ref.toUpperCase()}`));
        }
      }
      if (def.proformaAnnotations) {
        for (const [k, v] of Object.entries(def.proformaAnnotations(wb))) writer.put(k, v, at(null));
      }
      continue;
    }
    let found = false;
    for (const reader of def.readers.filter((x) => x.slot === f.slot)) {
      for (const sheet of wb.sheets) {
        const got = reader.read(sheet, (message) => notes.add(`${f.name} · ${sheet.name}: ${message}`));
        if (Object.keys(got).length > 0) {
          for (const [k, v] of Object.entries(got)) writer.put(k, v, at(sheet.name));
          found = true;
        }
      }
    }
    if (!found && def.readers.some((x) => x.slot === f.slot)) {
      notes.add(`${f.name}: no table this review knows how to read. Its figures need manual entry or a different slot.`);
    }
  }
  for (const n of writer.notes()) notes.add(n);
  return { readings, notes: [...notes], origins };
}

/** Index a sheet's cells by row and column. */
function indexSheet(sheet: XlsxSheet) {
  const m = new Map<string, XlsxSheet["cells"][number]>();
  for (const c of sheet.cells) m.set(`${c.row},${c.col}`, c);
  return m;
}

const MONTH_NAMES = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

const pad2 = (n: number) => String(n).padStart(2, "0");

/** A real calendar date as YYYY-MM-DD, or null. 31/02 is not a date. */
function calendarDate(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null;
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

/**
 * A cell as an ISO date. Reads YYYY-MM-DD, the Indian day-first forms
 * (15/11/2023, 15-11-2023, 15-Nov-2023, 15-Nov-23) and Excel serial numbers.
 * Day-first is the rule for slashed dates: a plant export is not read month-first.
 */
export function isoDate(v: unknown): string | null {
  if (typeof v === "string") {
    const s = v.trim();
    const iso = /^(\d{4})-(\d{2})-(\d{2})(?!\d)/.exec(s);
    if (iso) return calendarDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
    const dmy = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?!\d)/.exec(s);
    if (dmy) return calendarDate(Number(dmy[3]), Number(dmy[2]), Number(dmy[1]));
    const named = /^(\d{1,2})[-/ ]([A-Za-z]{3,9})\.?[-/ ](\d{4}|\d{2})(?!\d)/.exec(s);
    if (named) {
      const word = named[2]!.toLowerCase();
      const month = MONTH_NAMES.findIndex((name) => name.startsWith(word)) + 1;
      if (month > 0) {
        const year = named[3]!.length === 2 ? 2000 + Number(named[3]) : Number(named[3]);
        return calendarDate(year, month, Number(named[1]));
      }
    }
    return null;
  }
  if (typeof v === "number" && v > 20000 && v < 80000) {
    return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10);
  }
  return null;
}

const TONNE_UNITS = new Set(["t", "mt", "tonne", "tonnes", "ton", "tons"]);

function headerParts(s: string): { base: string; unit: string | null } {
  const unit = /\(([^)]*)\)\s*$/.exec(s.trim());
  const base = s
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[-_,/]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const raw = unit ? unit[1]!.trim().toLowerCase().replace(/\s+/g, "") : null;
  return { base, unit: raw === null || raw === "" ? null : TONNE_UNITS.has(raw) ? "t" : raw };
}

/**
 * Does a sheet cell name the header a reader wants? Case, spacing and a
 * parenthetical unit are ignored, but only when the units do not disagree:
 * "Clinker Production (kg)" is not "Clinker Production (t)", and a cell that is
 * only a unit matches nothing.
 */
export function headerMatches(cellValue: unknown, target: string): boolean {
  if (typeof cellValue !== "string") return false;
  if (cellValue.trim().toLowerCase() === target.trim().toLowerCase()) return true;
  const c = headerParts(cellValue);
  const t = headerParts(target);
  if (c.base === "" || c.base !== t.base) return false;
  return c.unit === null || t.unit === null || c.unit === t.unit;
}

export type DailyRow = { date: string; value: number | string | boolean | null };

export interface DailyColumnReport {
  /** Every row with a readable date. A row with no value is kept here and counted in `blank`. */
  rows: DailyRow[];
  /** Rows that hold a figure but no readable date. They are not in `rows`. */
  skipped: { row: number; raw: string }[];
  /** Dates that appear on more than one row. */
  duplicates: string[];
  /** Dated rows with nothing under the header. */
  blank: number;
}

const SUMMARY_LABEL = /^\s*(grand\s+)?(sub-?total|total|sum|average|avg|mean|max|min)\b/i;

export const isFilled = (v: unknown) => v !== null && v !== undefined && v !== "";

/**
 * The dated rows of the column under `header`, and what was left out. The date
 * column is the one below the header that holds the most dates, left-most on a
 * tie, so a serial-number column in A does not hide it. Null when the header is
 * absent or no row has a date.
 */
export function dailyColumnReport(sheet: XlsxSheet, header: string): DailyColumnReport | null {
  const h = sheet.cells.find((c) => headerMatches(c.value, header));
  if (!h) return null;
  const idx = indexSheet(sheet);
  const counts = new Map<number, number>();
  for (const c of sheet.cells) {
    if (c.row > h.row && c.col !== h.col && isoDate(c.value) !== null) counts.set(c.col, (counts.get(c.col) ?? 0) + 1);
  }
  let dateCol = 1;
  let best = 0;
  for (const [col, n] of counts) {
    if (n > best || (n === best && col < dateCol)) {
      dateCol = col;
      best = n;
    }
  }
  const rows: DailyRow[] = [];
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  let blank = 0;
  for (const d of sheet.cells) {
    if (d.col !== dateCol || d.row <= h.row) continue;
    const date = isoDate(d.value);
    if (!date) continue;
    const value = idx.get(`${d.row},${h.col}`)?.value ?? null;
    if (!isFilled(value)) blank += 1;
    if (seen.has(date)) duplicates.add(date);
    seen.add(date);
    rows.push({ date, value });
  }
  const skipped: { row: number; raw: string }[] = [];
  for (const c of sheet.cells) {
    if (c.col !== h.col || c.row <= h.row || !isFilled(c.value)) continue;
    const dateCell = idx.get(`${c.row},${dateCol}`)?.value;
    if (isoDate(dateCell) !== null) continue;
    const raw = dateCell === null || dateCell === undefined ? "" : String(dateCell);
    if (SUMMARY_LABEL.test(raw)) continue;
    skipped.push({ row: c.row, raw });
  }
  return rows.length > 0 ? { rows, skipped, duplicates: [...duplicates].sort(), blank } : null;
}

/** Say what a daily column left out, in sentences a reviewer can act on. */
export function noteDailyColumn(report: DailyColumnReport, header: string, note?: (message: string) => void): void {
  if (!note) return;
  if (report.skipped.length > 0) {
    const first = report.skipped[0]!;
    note(
      `${report.skipped.length} row(s) under "${header}" have a figure but no date this review can read, so they are left out (first: row ${first.row}, date cell ${first.raw === "" ? "empty" : `"${first.raw}"`}).`
    );
  }
  if (report.duplicates.length > 0) {
    note(`${report.duplicates.length} date(s) appear on more than one row under "${header}" (first: ${report.duplicates[0]}). The daily series keeps the later row; the total counts both.`);
  }
  if (report.blank > 0) {
    note(`${report.blank} dated row(s) have nothing under "${header}". They are not counted as zero output or as evidence for a month.`);
  }
}

/** Dated rows of the column under `header`. Null when the header is absent. */
export function dailyColumn(sheet: XlsxSheet, header: string): DailyRow[] | null {
  return dailyColumnReport(sheet, header)?.rows ?? null;
}

/** Dates of the rows that carry a figure. A pre-filled calendar with empty cells is not evidence. */
export const filledDates = (rows: DailyRow[]) => rows.filter((r) => isFilled(r.value)).map((r) => r.date);

export const months = (dates: string[]) => new Set(dates.map((d) => d.slice(0, 7))).size;

/** A month with fewer rows than this share of the typical month counts as thin, on a daily series. */
export const THIN_MONTH_SHARE = 0.5;
/** Below this many rows in a typical month the series is not daily, and no month is called thin. */
export const DAILY_SERIES_MIN_ROWS = 10;

/** Months whose row count is far below the series' own typical month. Empty for a series that is not daily. */
export function thinMonths(dates: string[]): string[] {
  const per = new Map<string, Set<string>>();
  for (const d of dates) {
    const m = d.slice(0, 7);
    const set = per.get(m) ?? new Set<string>();
    set.add(d);
    per.set(m, set);
  }
  const counts = [...per.values()].map((s) => s.size).sort((a, b) => a - b);
  if (counts.length === 0) return [];
  const typical = counts[Math.floor(counts.length / 2)]!;
  if (typical < DAILY_SERIES_MIN_ROWS) return [];
  return [...per]
    .filter(([, s]) => s.size < typical * THIN_MONTH_SHARE)
    .map(([m]) => m)
    .sort();
}
