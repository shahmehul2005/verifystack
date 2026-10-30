/**
 * Propose candidate readings for desk review from the text layer of evidence PDFs.
 *
 * Adheres to Principle 3: "AI proposes, humans decide." A suggestion is never a fact
 * and never a reading until the auditor accepts it. This module is deterministic: it
 * matches printed labels on the page against a table of extractors and returns the
 * number that was printed, with its page and the exact line it came from.
 *
 * What it will not do, on purpose:
 *   - It carries no figures. Every value comes from the document in front of it, so a
 *     document that was edited after the fact produces the edited figure, not a
 *     remembered one.
 *   - It does not OCR. A page with no text layer yields nothing, and the route reports
 *     that so the auditor types the figure from the page instead.
 *   - It does not reach across slots. A reading is proposed only from a document that
 *     sits in the slot the reading belongs to.
 */

import type { DeskReviewDef } from "./engine";
import { inferSlot } from "./engine";
import type { PdfPageText } from "../extraction/pdfText";

export interface EvidenceDocumentCandidate {
  id: string;
  name: string;
  slot: string | null;
  docType?: string | null;
  /** Text layer by page. Null or empty means the document has no readable text layer. */
  pages?: PdfPageText[] | null;
}

export interface ProposedReading {
  key: string;
  label: string;
  value: number;
  rawText?: string;
  unit: string;
  documentId: string;
  documentName: string;
  page?: number;
  confidence: number;
  /** The exact printed line the value was read from. */
  sourceText: string;
  note?: string;
}

/** A document the proposer could not read, so the auditor knows why nothing came back. */
export interface UnreadableDocument {
  documentId: string;
  documentName: string;
  reason: "no_text_layer" | "not_a_pdf";
}

const NUM = String.raw`(-?\d[\d,]*(?:\.\d+)?)`;
const NIL = String.raw`(?:nil|none|0)`;

interface LineExtractor {
  /** Pattern for one printed line. The last capture group is the number. */
  line: RegExp;
}

/**
 * Printed-label extractors by reading key. A pattern is anchored on the label the
 * statutory form or the plant report prints, so unrelated numbers on the same page
 * do not match. Add a pattern here when a new template appears; never add a number.
 */
const NUMERIC_EXTRACTORS: Record<string, LineExtractor[]> = {
  "mpr.clinker_t": [{ line: new RegExp(String.raw`^Clinker Production\b.*?\s${NUM}$`, "i") }],
  "mpr.opc_t": [{ line: new RegExp(String.raw`^OPC (?:Produced|Production)\b.*?\s${NUM}$`, "i") }],
  "mpr.ppc_t": [{ line: new RegExp(String.raw`^PPC (?:Produced|Production)\b.*?\s${NUM}$`, "i") }],
  "mpr.psc_t": [{ line: new RegExp(String.raw`^PSC (?:Produced|Production)\b.*?\s${NUM}$`, "i") }],
  "mpr.clinker_opening_t": [{ line: new RegExp(String.raw`^Clinker Opening Stock\b.*?\s${NUM}$`, "i") }],
  "mpr.clinker_closing_t": [{ line: new RegExp(String.raw`^Clinker Closing Stock\b.*?\s${NUM}$`, "i") }],
  "mpr.clinker_import_t": [{ line: new RegExp(String.raw`^Clinker (?:Import(?:ed)?|Purchased)\b.*?\s${NUM}$`, "i") }],
  "mpr.clinker_export_t": [{ line: new RegExp(String.raw`^Clinker (?:Export(?:ed)?|Sold)\b.*?\s${NUM}$`, "i") }],
  // SAP rows print: material, material code, order qty, confirmed qty, plant. Confirmed is the
  // second figure after the code, never the order quantity.
  "sap.opc_t": [{ line: new RegExp(String.raw`\bFG-CLK-OPC\s+${NUM}\s+${NUM}(?:\s|$)`, "i") }],
  "sap.ppc_t": [{ line: new RegExp(String.raw`\bFG-CEM-PPC\w*\s+${NUM}\s+${NUM}(?:\s|$)`, "i") }],
  "sap.psc_t": [{ line: new RegExp(String.raw`\bFG-CEM-PSC\w*\s+${NUM}\s+${NUM}(?:\s|$)`, "i") }],
  "cpp.report_lakh_kwh": [{ line: new RegExp(String.raw`^Gross Generation\s*\(\s*Lakh kWh\b[^)]*\)\s+${NUM}$`, "i") }],
  "grid.bill_kwh": [{ line: new RegExp(String.raw`^Units (?:Consumed|Billed)\s*\(\s*kWh\s*\)\s+${NUM}$`, "i") }],
  "coal.po_t": [{ line: new RegExp(String.raw`^Quantity Ordered\s+${NUM}\s*(?:t|mt|tonnes?)\b`, "i") }],
  // The certificate prints: parameter, internal lab result, NABL external result, deviation.
  // The reading is the external (NABL) result, the second figure.
  "coal.nabl_gcv": [
    { line: new RegExp(String.raw`^GCV\b[^\d]*?\)?\s+${NUM}\s+${NUM}\s+[+\-\u2212\u2013]?\d`, "i") },
  ],
  "form1.eq_product_t": [{ line: new RegExp(String.raw`^Total Equivalent Product\b(?:\s+Tonnes?)?\s+${NUM}$`, "i") }],
  "form1.direct_co2_t": [{ line: new RegExp(String.raw`^Direct GHG Emissions\b.*?\s${NUM}$`, "i") }],
  "form1.indirect_co2_t": [{ line: new RegExp(String.raw`^Indirect GHG Emissions\b.*?\s${NUM}$`, "i") }],
};

/**
 * Declarations that print "Nil" where a quantity would go. These propose 0 only when
 * every named row says nil; a printed capacity or quantity is for the auditor to read.
 */
const NIL_EXTRACTORS: Record<string, RegExp[]> = {
  "rec.claim_mwh": [
    new RegExp(String.raw`^Onsite Renewable Generation\b.*\s${NIL}$`, "i"),
    new RegExp(String.raw`^Open Access\b.*\s${NIL}$`, "i"),
  ],
  "rec.purchases_mwh": [new RegExp(String.raw`^RECs? (?:purchased|obtained)\b.*\s${NIL}$`, "i")],
};

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH_WORD = String.raw`(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*`;

function parseNumber(raw: string): number | null {
  const n = Number(raw.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function monthIndex(word: string): number {
  return MONTHS.indexOf(word.slice(0, 3).toLowerCase());
}

/**
 * Whole months a document says it covers, from its printed "Period:" or "Billing
 * Period" statement. Returns null when the period is not stated in a form this can
 * count exactly; the auditor then enters it. Quarters count as three, a financial
 * year as twelve.
 */
export function printedPeriodMonths(lines: string[]): number | null {
  for (const line of lines) {
    const m = /(?:\bPeriod\b|Billing Period)\s*:?\s*(.+)$/i.exec(line);
    if (!m) continue;
    const text = m[1]!.replace(/\(.*?\)/g, " ").trim();

    const fin = /\b(?:FY|F\.Y\.)?\s*(\d{4})\s*[-\u2013]\s*(\d{2,4})\b/.exec(text);
    if (/^q[1-4]\b/i.test(text) && fin) return 3;

    const range = new RegExp(
      String.raw`(?:\d{1,2}[-\s])?${MONTH_WORD}[-\s,]*(\d{4})\s*(?:to|-|\u2013|until)\s*(?:\d{1,2}[-\s])?${MONTH_WORD}[-\s,]*(\d{4})`,
      "i"
    ).exec(text);
    if (range) {
      const a = Number(range[2]) * 12 + monthIndex(range[1]!);
      const b = Number(range[4]) * 12 + monthIndex(range[3]!);
      const span = b - a + 1;
      return span >= 1 && span <= 24 ? span : null;
    }

    const single = new RegExp(String.raw`^(?:\d{1,2}[-\s])?${MONTH_WORD}[-\s,]*(\d{4})\b`, "i").exec(text);
    if (single) return 1;

    const stated = /^(\d{1,2})\s*months?\b/i.exec(text);
    if (stated) return Number(stated[1]);
  }
  return null;
}

function allLines(pages: PdfPageText[]): { page: number; line: string }[] {
  return pages.flatMap((p) => p.lines.map((line) => ({ page: p.page, line })));
}

function readNumeric(pages: PdfPageText[], extractors: LineExtractor[]): { value: number; page: number; line: string } | null {
  for (const { page, line } of allLines(pages)) {
    for (const ex of extractors) {
      const hit = ex.line.exec(line);
      if (!hit) continue;
      const value = parseNumber(hit[hit.length - 1]!);
      if (value !== null) return { value, page, line };
    }
  }
  return null;
}

function readNilDeclaration(pages: PdfPageText[], rows: RegExp[]): { page: number; line: string } | null {
  const lines = allLines(pages);
  const found = rows.map((re) => lines.find((l) => re.test(l.line)));
  if (found.some((f) => !f)) return null;
  const first = found[0]!;
  return { page: first.page, line: found.map((f) => f!.line).join(" | ") };
}

/**
 * One line per day from a printed daily table. The header must start `Date` then the
 * wanted column, and the series is read only while rows keep starting with a date.
 */
function readDailySeries(pages: PdfPageText[], column: RegExp): { rows: [string, number][]; page: number; header: string } | null {
  for (const p of pages) {
    const headerAt = p.lines.findIndex((l) => /^date\b/i.test(l) && column.test(l.replace(/^date\s+/i, "")));
    if (headerAt < 0) continue;
    const rows: [string, number][] = [];
    for (const line of p.lines.slice(headerAt + 1)) {
      const hit = /^(\d{4}-\d{2}-\d{2})\s+(-?\d[\d,]*(?:\.\d+)?)(?:\s|$)/.exec(line);
      if (!hit) {
        if (rows.length > 0) break;
        continue;
      }
      const value = parseNumber(hit[2]!);
      if (value !== null) rows.push([hit[1]!, value]);
    }
    if (rows.length > 0) return { rows, page: p.page, header: p.lines[headerAt]! };
  }
  return null;
}

const MONTHS_FROM_PERIOD = new Set(["grid.bill_months", "coal.po_months"]);

export interface ProposeResult {
  suggestions: ProposedReading[];
  unreadable: UnreadableDocument[];
}

/**
 * Scan documents that sit in evidence slots and propose candidate readings. Pure
 * function of the document text it is given.
 */
export function proposeFromDocuments(def: DeskReviewDef, documents: EvidenceDocumentCandidate[]): ProposeResult {
  const unreadable: UnreadableDocument[] = [];
  const readable = documents.filter((d) => {
    const hasText = (d.pages ?? []).some((p) => p.lines.length > 0);
    if (!hasText) unreadable.push({ documentId: d.id, documentName: d.name, reason: d.pages ? "no_text_layer" : "not_a_pdf" });
    return hasText;
  });

  const suggestions: ProposedReading[] = [];

  for (const spec of def.manual) {
    const candidates = readable.filter((d) => (d.slot ?? inferSlot(d)) === spec.slot);
    if (candidates.length === 0) continue;

    type Found = Omit<ProposedReading, "key" | "label" | "unit" | "documentId" | "documentName" | "confidence">;
    const hits: { doc: EvidenceDocumentCandidate; found: Found; confidence: number }[] = [];

    for (const doc of candidates) {
      const pages = doc.pages!;

      if (spec.kind === "daily") {
        const series = readDailySeries(pages, /^clinker\b/i);
        if (series && spec.key === "dpr.clinker") {
          const text = series.rows.map(([d, v]) => `${d} ${v}`).join("\n");
          hits.push({
            doc,
            confidence: 0.9,
            found: {
              value: series.rows[0]![1],
              rawText: text,
              page: series.page,
              sourceText: `${series.header} | ${series.rows.length} dated rows, ${series.rows[0]![0]} to ${series.rows[series.rows.length - 1]![0]}`,
              note: `Daily series read from the printed table in ${doc.name}. Covers ${series.rows.length} days only; the workbook series is the population.`,
            },
          });
        }
        continue;
      }

      if (MONTHS_FROM_PERIOD.has(spec.key)) {
        const months = printedPeriodMonths(pages.flatMap((p) => p.lines));
        if (months !== null) {
          const line = pages.flatMap((p) => p.lines).find((l) => /\bPeriod\b/i.test(l)) ?? "Period";
          hits.push({
            doc,
            confidence: 0.8,
            found: { value: months, page: 1, sourceText: line, note: "Counted from the period the document prints." },
          });
        }
        continue;
      }

      const nil = NIL_EXTRACTORS[spec.key];
      if (nil) {
        const decl = readNilDeclaration(pages, nil);
        if (decl) {
          hits.push({
            doc,
            confidence: 0.9,
            found: { value: 0, page: decl.page, sourceText: decl.line, note: "Every row of the declaration prints nil." },
          });
        }
        continue;
      }

      const extractors = NUMERIC_EXTRACTORS[spec.key];
      if (!extractors) continue;
      const hit = readNumeric(pages, extractors);
      if (hit) {
        hits.push({
          doc,
          confidence: 0.9,
          found: { value: hit.value, page: hit.page, sourceText: hit.line, note: `Read from the printed line in ${doc.name}.` },
        });
      }
    }

    const first = hits[0];
    if (!first) continue;

    // Two documents giving different figures for one reading is itself the finding;
    // surface it in the note rather than choosing quietly.
    const disagreeing = hits.filter((h) => h.found.value !== first.found.value);
    const note = disagreeing.length
      ? `${first.found.note ?? ""} ${disagreeing.length} other document(s) in this slot print a different figure: ${disagreeing
          .map((h) => `${h.doc.name} ${h.found.value}`)
          .join("; ")}. Resolve before accepting.`.trim()
      : first.found.note;

    suggestions.push({
      key: spec.key,
      label: spec.label,
      unit: spec.unit,
      documentId: first.doc.id,
      documentName: first.doc.name,
      confidence: disagreeing.length ? Math.min(first.confidence, 0.5) : first.confidence,
      ...first.found,
      ...(note ? { note } : {}),
    });
  }

  return { suggestions, unreadable };
}

/** Back-compatible wrapper for callers that only need the suggestions. */
export function proposeReadings(def: DeskReviewDef, documents: EvidenceDocumentCandidate[]): ProposedReading[] {
  return proposeFromDocuments(def, documents).suggestions;
}
