/**
 * Shared reading of tabular evidence (DFD 2.4, 2.5, D10).
 *
 * One place turns an uploaded XLSX or CSV into sheets of addressable cells, so
 * the upload path (which records a preview) and the mapping path (which reads a
 * cell to propose a value) cannot disagree about what a cell contains. The
 * mapping path always re-reads the stored bytes; a value sent by the browser is
 * never trusted.
 */

import { parseCsv } from "./csv";
import { columnLetters, parseXlsx, type CellValue, type XlsxCell, type XlsxSheet } from "./xlsx";

export const PREVIEW_ROWS = 40;
export const PREVIEW_COLS = 12;

const NUMERIC = /^[+-]?(\d{1,3}(,\d{3})+|\d+)(\.\d+)?([eE][+-]?\d+)?$|^[+-]?\.\d+$/;

/** CSV has no types. Plain numbers (with optional thousands commas) become numbers. */
export function csvCellValue(raw: string): CellValue {
  const s = raw.trim();
  if (s === "") return null;
  if (NUMERIC.test(s)) {
    const n = Number(s.replace(/,/g, ""));
    if (Number.isFinite(n)) return n;
  }
  return raw;
}

/** A CSV as one sheet. Cell addresses are positional, so A1 is the first field of the first row. */
export function csvToSheet(name: string, rows: string[][]): XlsxSheet {
  const cells: XlsxCell[] = [];
  let colCount = 0;
  rows.forEach((row, r) => {
    colCount = Math.max(colCount, row.length);
    row.forEach((raw, c) => {
      const value = csvCellValue(raw);
      if (value === null) return;
      cells.push({ ref: `${columnLetters(c + 1)}${r + 1}`, row: r + 1, col: c + 1, value });
    });
  });
  return { name, cells, rowCount: rows.length, colCount, truncated: false };
}

export function sheetsFromBytes(
  bytes: Uint8Array,
  kind: "spreadsheet" | "csv",
  filename: string
): XlsxSheet[] {
  if (kind === "spreadsheet") return parseXlsx(bytes).sheets;
  const text = new TextDecoder("utf-8").decode(bytes);
  const { rows } = parseCsv(text);
  return [csvToSheet(filename.replace(/\.[^.]+$/, "") || "Sheet1", rows)];
}

/**
 * A sheet as a plain grid of strings, row 1 first, for importers that work on
 * rows rather than addressed cells. Empty cells are empty strings.
 */
export function sheetToTable(sheet: XlsxSheet): string[][] {
  const table: string[][] = Array.from({ length: sheet.rowCount }, () =>
    Array.from({ length: sheet.colCount }, () => "")
  );
  for (const c of sheet.cells) {
    const row = table[c.row - 1];
    if (row && c.col >= 1 && c.col <= sheet.colCount) row[c.col - 1] = c.value === null ? "" : String(c.value);
  }
  return table;
}

export interface SheetPreview {
  rowCount: number;
  colCount: number;
  truncated: boolean;
  /** Row-major, row 1 first, capped at PREVIEW_ROWS x PREVIEW_COLS. */
  rows: CellValue[][];
}

export function previewSheet(sheet: XlsxSheet): SheetPreview {
  const rows: CellValue[][] = Array.from({ length: Math.min(sheet.rowCount, PREVIEW_ROWS) }, () =>
    Array.from({ length: Math.min(sheet.colCount, PREVIEW_COLS) }, () => null)
  );
  for (const c of sheet.cells) {
    if (c.row <= PREVIEW_ROWS && c.col <= PREVIEW_COLS) rows[c.row - 1]![c.col - 1] = c.value;
  }
  return {
    rowCount: sheet.rowCount,
    colCount: sheet.colCount,
    truncated: sheet.truncated || sheet.rowCount > PREVIEW_ROWS || sheet.colCount > PREVIEW_COLS,
    rows,
  };
}

export class CellReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CellReadError";
  }
}

export interface CellRead {
  sheet: string;
  cellRef: string;
  value: string | number | boolean;
  formula?: string;
}

/**
 * The value at `sheet!cellRef`, or a reason it cannot be a proposal. An empty
 * cell is refused: a blank is not evidence of anything.
 */
export function readCell(sheets: XlsxSheet[], sheetName: string, cellRef: string): CellRead {
  const sheet = sheets.find((s) => s.name === sheetName);
  if (!sheet) throw new CellReadError(`There is no sheet named "${sheetName}".`);
  const cell = sheet.cells.find((c) => c.ref === cellRef);
  if (!cell || cell.value === null || cell.value === "") {
    throw new CellReadError(`${sheetName}!${cellRef} is empty.`);
  }
  return {
    sheet: sheet.name,
    cellRef,
    value: cell.value,
    ...(cell.formula ? { formula: cell.formula } : {}),
  };
}
