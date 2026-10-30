/**
 * XLSX reader (DFD 2.4). Dependency-free: an XLSX is a ZIP of XML parts.
 *
 * Reads sheet names, cell values and formulas. It does not evaluate formulas;
 * the cached value Excel stored is what a verifier saw, and it is what we
 * record, alongside the formula text. Dates arrive as Excel serial numbers and
 * are left as numbers, because the number format that says "this is a date" is
 * not read here and guessing would put a wrong date into evidence.
 *
 * Refused: macro-enabled content is ignored, external links are ignored,
 * encrypted workbooks (not a ZIP) fail in `openZip`.
 */

import { openZip, ZipError, type ZipArchive } from "../archive/zip";

export class XlsxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "XlsxError";
  }
}

export type CellValue = string | number | boolean | null;

export interface XlsxCell {
  ref: string;
  row: number;
  col: number;
  value: CellValue;
  formula?: string;
}

export interface XlsxSheet {
  name: string;
  cells: XlsxCell[];
  rowCount: number;
  colCount: number;
  truncated: boolean;
}

export interface XlsxWorkbook {
  sheets: XlsxSheet[];
}

export interface XlsxLimits {
  maxSheets: number;
  maxCellsPerSheet: number;
}

export const DEFAULT_XLSX_LIMITS: XlsxLimits = { maxSheets: 50, maxCellsPerSheet: 250_000 };

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
};

function decodeXml(s: string): string {
  return s
    .replace(/&(?:amp|lt|gt|quot|apos);/g, (m) => ENTITIES[m]!)
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(parseInt(d, 10)));
}

/** "AB12" -> { col: 28, row: 12 }. Null when the reference is not A1 style. */
export function parseCellRef(ref: string): { col: number; row: number } | null {
  const m = /^([A-Z]{1,3})([1-9][0-9]{0,6})$/.exec(ref);
  if (!m) return null;
  let col = 0;
  for (const ch of m[1]!) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { col, row: Number(m[2]) };
}

export function columnLetters(col: number): string {
  let s = "";
  let n = col;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function attr(tag: string, name: string): string | undefined {
  const m = new RegExp(`\\b${name}="([^"]*)"`).exec(tag);
  return m ? decodeXml(m[1]!) : undefined;
}

/** Concatenate the <t> runs inside a shared-string or inline-string item. */
function textRuns(xml: string): string {
  let out = "";
  for (const m of xml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) out += decodeXml(m[1]!);
  return out;
}

function readSharedStrings(zip: ZipArchive): string[] {
  if (!zip.has("xl/sharedStrings.xml")) return [];
  const xml = zip.readText("xl/sharedStrings.xml");
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) => textRuns(m[1]!));
}

function resolveTarget(target: string): string {
  const t = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
  // collapse "xl/../x" style segments
  const parts: string[] = [];
  for (const seg of t.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg !== "." && seg !== "") parts.push(seg);
  }
  return parts.join("/");
}

export function parseXlsx(
  data: Uint8Array,
  limits: XlsxLimits = DEFAULT_XLSX_LIMITS
): XlsxWorkbook {
  let zip: ZipArchive;
  try {
    zip = openZip(data);
  } catch (e) {
    if (e instanceof ZipError) {
      throw new XlsxError(`Not a readable .xlsx file: ${e.message}`);
    }
    throw e;
  }
  if (!zip.has("xl/workbook.xml")) throw new XlsxError("Not an .xlsx workbook: xl/workbook.xml is missing.");

  const workbook = zip.readText("xl/workbook.xml");
  const rels = zip.has("xl/_rels/workbook.xml.rels") ? zip.readText("xl/_rels/workbook.xml.rels") : "";
  const relTarget = new Map<string, string>();
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = attr(m[0], "Id");
    const target = attr(m[0], "Target");
    if (id && target) relTarget.set(id, target);
  }

  // Sheet tags may carry an XML namespace prefix (e.g. <x:sheet .../>) in
  // workbooks that declare a default or explicit namespace on the root element.
  // The prefix can be any NCName, so we match the optional "prefix:" part.
  const sheetTags = [...workbook.matchAll(/<(?:[A-Za-z_][\w.]*:)?sheet\b[^>]*\/?>/g)].map((m) => m[0]);
  if (sheetTags.length === 0) throw new XlsxError("The workbook has no sheets.");
  if (sheetTags.length > limits.maxSheets) {
    throw new XlsxError(`The workbook has ${sheetTags.length} sheets; the limit is ${limits.maxSheets}.`);
  }

  const shared = readSharedStrings(zip);
  const sheets: XlsxSheet[] = [];

  sheetTags.forEach((tag, idx) => {
    const name = attr(tag, "name") ?? `Sheet${idx + 1}`;
    const rid = /\br:id="([^"]*)"/.exec(tag)?.[1];
    const target = rid ? relTarget.get(rid) : undefined;
    const path = target ? resolveTarget(target) : `xl/worksheets/sheet${idx + 1}.xml`;
    if (!zip.has(path)) {
      throw new XlsxError(`Sheet "${name}" points at a missing part (${path}).`);
    }
    const xml = zip.readText(path);
    const cells: XlsxCell[] = [];
    let truncated = false;
    let maxRow = 0;
    let maxCol = 0;

    for (const m of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const head = m[1] ?? "";
      const body = m[2] ?? "";
      const ref = attr(head, "r");
      const pos = ref ? parseCellRef(ref) : null;
      if (!ref || !pos) continue;
      const t = attr(head, "t");
      const rawV = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body)?.[1];
      const formula = /<f\b[^>]*>([\s\S]*?)<\/f>/.exec(body)?.[1];

      let value: CellValue = null;
      if (t === "inlineStr") {
        value = textRuns(body);
      } else if (rawV !== undefined) {
        const v = decodeXml(rawV);
        if (t === "s") value = shared[Number(v)] ?? null;
        else if (t === "str" || t === "e") value = v;
        else if (t === "b") value = v === "1";
        else {
          const n = Number(v);
          value = Number.isFinite(n) ? n : v;
        }
      }
      if (value === null && formula === undefined) continue;

      if (cells.length >= limits.maxCellsPerSheet) {
        truncated = true;
        break;
      }
      cells.push({
        ref,
        row: pos.row,
        col: pos.col,
        value,
        ...(formula !== undefined ? { formula: decodeXml(formula) } : {}),
      });
      if (pos.row > maxRow) maxRow = pos.row;
      if (pos.col > maxCol) maxCol = pos.col;
    }
    sheets.push({ name, cells, rowCount: maxRow, colCount: maxCol, truncated });
  });

  return { sheets };
}

export function cellAt(sheet: XlsxSheet, ref: string): XlsxCell | undefined {
  return sheet.cells.find((c) => c.ref === ref);
}

/** Rows as arrays of values, row 1 first. Empty cells are null. */
export function sheetRows(sheet: XlsxSheet): CellValue[][] {
  const rows: CellValue[][] = Array.from({ length: sheet.rowCount }, () =>
    Array.from({ length: sheet.colCount }, () => null)
  );
  for (const c of sheet.cells) rows[c.row - 1]![c.col - 1] = c.value;
  return rows;
}
