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
  read(sheet: XlsxSheet): Readings;
}

export interface DeskReviewDef {
  packId: string;
  /** Pro forma cells that rules compare against. The key is the reading key. */
  proformaCells: ProformaInput[];
  readers: WorkbookReader[];
  manual: ManualReadingSpec[];
  rules: DeskRule[];
}

export type DeskStatus = CheckStatus | "pending";

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

export function runDeskReview(def: DeskReviewDef, readings: Readings): DeskOutcome[] {
  return def.rules.map((rule) => {
    const missing = rule.needs.filter((k) => !has(readings, k));
    const base = { id: rule.id, section: rule.section, label: rule.label };
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
}

/** Workbook readings for every spreadsheet in a slot, plus the notes a reader leaves. */
export function readWorkbooks(
  def: DeskReviewDef,
  files: DeskWorkbook[],
  runInputs: readonly ProformaInput[]
): { readings: Readings; notes: string[] } {
  const readings: Readings = {};
  const notes: string[] = [];
  for (const f of files) {
    let wb: XlsxWorkbook;
    try {
      wb = parseXlsx(f.bytes);
    } catch {
      notes.push(`${f.name} could not be opened as a workbook.`);
      continue;
    }
    if (f.slot === "proforma_workbook") {
      const cells = readProforma(wb, def.proformaCells);
      for (const d of cells.drafts) {
        if (d.fieldPath && d.value !== null && (d.status === "found" || d.status === "zero")) readings[d.fieldPath] = d.value;
      }
      const unmapped = readProforma(wb, runInputs).drafts.filter((d) => d.status === "unmapped" && (d.value ?? 0) > 0);
      readings["pf.unmapped_count"] = unmapped.length;
      readings["pf.unmapped_list"] = unmapped.map((d) => `${d.label} = ${d.workbookValue}`).join("; ");
      if (cells.staleFormulaCells > 0) {
        notes.push(`${f.name}: ${cells.staleFormulaCells} formula cell(s) stored a result that differs from the formula; values here are recomputed.`);
      }
      continue;
    }
    let found = false;
    for (const reader of def.readers.filter((x) => x.slot === f.slot)) {
      for (const sheet of wb.sheets) {
        const got = reader.read(sheet);
        if (Object.keys(got).length > 0) {
          Object.assign(readings, got);
          found = true;
        }
      }
    }
    if (!found && def.readers.some((x) => x.slot === f.slot)) {
      notes.push(`${f.name}: no table this review knows how to read. Its figures need manual entry or a different slot.`);
    }
  }
  return { readings, notes };
}

/** Index a sheet's cells by row and column. */
function indexSheet(sheet: XlsxSheet) {
  const m = new Map<string, XlsxSheet["cells"][number]>();
  for (const c of sheet.cells) m.set(`${c.row},${c.col}`, c);
  return m;
}

const MONTH_NAMES: Record<string, string> = {
  jan: "01",
  feb: "02",
  mar: "03",
  apr: "04",
  may: "05",
  jun: "06",
  jul: "07",
  aug: "08",
  sep: "09",
  oct: "10",
  nov: "11",
  dec: "12",
};

export function isoDate(v: unknown): string | null {
  if (typeof v === "string") {
    const s = v.trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);

    // Match DD/MM/YYYY or DD-MM-YYYY (e.g. 01/11/2023 or 01-11-2023)
    const dmy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
    if (dmy) {
      const day = dmy[1]!.padStart(2, "0");
      const month = dmy[2]!.padStart(2, "0");
      const year = dmy[3]!;
      return `${year}-${month}-${day}`;
    }

    // Match DD-MMM-YYYY (e.g. 01-Nov-2023 or 1-Apr-2024)
    const dMmmY = s.match(/^(\d{1,2})[-/ ]([A-Za-z]{3})[-/ ](\d{2,4})/);
    if (dMmmY) {
      const day = dMmmY[1]!.padStart(2, "0");
      const mKey = dMmmY[2]!.toLowerCase();
      const month = MONTH_NAMES[mKey];
      if (month) {
        let year = dMmmY[3]!;
        if (year.length === 2) year = `20${year}`;
        return `${year}-${month}-${day}`;
      }
    }
  }
  if (typeof v === "number" && v > 20000 && v < 80000) {
    return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10);
  }
  return null;
}

/** Dated rows (dates in column A) of the column under `header`. Null when the header is absent. */
export function headerMatches(cellValue: unknown, target: string): boolean {
  if (typeof cellValue !== "string") return false;
  const c = cellValue.trim().toLowerCase();
  const t = target.trim().toLowerCase();
  if (c === t) return true;
  // Normalized without parenthetical units & punctuation
  const normC = c.replace(/\([^)]*\)/g, "").replace(/[\-_,\/]/g, " ").replace(/\s+/g, " ").trim();
  const normT = t.replace(/\([^)]*\)/g, "").replace(/[\-_,\/]/g, " ").replace(/\s+/g, " ").trim();
  if (normC === normT) return true;
  if (normC.startsWith(normT) || normT.startsWith(normC)) return true;
  return false;
}

export function dailyColumn(sheet: XlsxSheet, header: string): { date: string; value: number | string | boolean | null }[] | null {
  const h = sheet.cells.find((c) => headerMatches(c.value, header));

  if (!h) return null;
  const idx = indexSheet(sheet);
  // Auto-detect date column by checking which column has valid dates below the header row
  const dateColCounts = new Map<number, number>();
  for (const c of sheet.cells) {
    if (c.row > h.row && c.col !== h.col) {
      if (isoDate(c.value) !== null) {
        dateColCounts.set(c.col, (dateColCounts.get(c.col) ?? 0) + 1);
      }
    }
  }

  // Best candidate date column, fallback to column 1
  let dateCol = 1;
  let maxDates = 0;
  for (const [col, count] of dateColCounts.entries()) {
    if (count > maxDates) {
      maxDates = count;
      dateCol = col;
    }
  }

  const out: { date: string; value: number | string | boolean | null }[] = [];
  for (const d of sheet.cells) {
    if (d.col !== dateCol || d.row <= h.row) continue;
    const date = isoDate(d.value);
    if (!date) continue;
    out.push({ date, value: idx.get(`${d.row},${h.col}`)?.value ?? null });
  }
  return out.length > 0 ? out : null;
}

export const months = (dates: string[]) => new Set(dates.map((d) => d.slice(0, 7))).size;
