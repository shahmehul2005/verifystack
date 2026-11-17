/**
 * Pure helpers for the desk-review pro forma preview (Requirement 20).
 *
 * Decides how a stored document is previewed and builds a bounded, read-only
 * window over a parsed workbook. Cell values and formula text pass through
 * unchanged: no unit conversion, rounding or date interpretation.
 */

import { CSV_MIME, isEvidenceMimeType, XLSX_MIME } from "../../lib/evidence";
import {
  columnLetters,
  type CellValue,
  type XlsxCell,
  type XlsxSheet,
  type XlsxWorkbook,
} from "./xlsx";

export type PreviewMode = "embed" | "sheet" | "none";

/** embed: the File_Route renders it inline. sheet: read from workbook data. none: Download only. */
export function previewModeFor(mime: string | null | undefined): PreviewMode {
  if (isEvidenceMimeType(mime)) return "embed";
  if (mime === XLSX_MIME || mime === CSV_MIME) return "sheet";
  return "none";
}

/** The document the panel selects first: the `proforma_workbook` slot, else the first document, else "". */
export function pickDefaultPreviewDoc(
  docs: readonly { id: string; slot?: string | null }[]
): string {
  const proforma = docs.find((d) => d.slot === "proforma_workbook");
  return (proforma ?? docs[0])?.id ?? "";
}

export interface SheetWindowRequest {
  sheetIndex?: number;
  rowStart?: number;
  rowLimit?: number;
}

export interface SheetView {
  sheets: { name: string; rowCount: number; colCount: number }[];
  active: {
    index: number;
    name: string;
    columns: string[];
    rowStart: number;
    rows: { n: number; cells: { value: CellValue; formula?: string }[] }[];
    hasMoreRows: boolean;
    hasMoreColumns: boolean;
    sourceTruncated: boolean;
  };
}

export const SHEET_VIEW_LIMITS = { defaultRows: 200, maxRows: 500, maxColumns: 100 } as const;

function clampInt(value: number | undefined, min: number, max: number, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

export function buildSheetView(workbook: XlsxWorkbook, req: SheetWindowRequest): SheetView {
  const sheets = workbook.sheets.map((s) => ({
    name: s.name,
    rowCount: s.rowCount,
    colCount: s.colCount,
  }));
  const index = clampInt(req.sheetIndex, 0, Math.max(0, workbook.sheets.length - 1), 0);
  const sheet: XlsxSheet | undefined = workbook.sheets[index];
  const rowStart = clampInt(req.rowStart, 1, Number.MAX_SAFE_INTEGER, 1);
  const rowLimit = clampInt(
    req.rowLimit,
    1,
    SHEET_VIEW_LIMITS.maxRows,
    SHEET_VIEW_LIMITS.defaultRows
  );

  if (!sheet) {
    return {
      sheets,
      active: {
        index: 0,
        name: "",
        columns: [],
        rowStart,
        rows: [],
        hasMoreRows: false,
        hasMoreColumns: false,
        sourceTruncated: false,
      },
    };
  }

  const colCount = Math.min(sheet.colCount, SHEET_VIEW_LIMITS.maxColumns);
  const lastRow = Math.min(sheet.rowCount, rowStart + rowLimit - 1);

  const byPosition = new Map<number, XlsxCell>();
  for (const c of sheet.cells) {
    if (c.row >= rowStart && c.row <= lastRow && c.col <= colCount) {
      byPosition.set(c.row * 1_000 + c.col, c);
    }
  }

  const columns = Array.from({ length: colCount }, (_, i) => columnLetters(i + 1));
  const rows: SheetView["active"]["rows"] = [];
  for (let n = rowStart; n <= lastRow; n++) {
    const cells: { value: CellValue; formula?: string }[] = [];
    for (let col = 1; col <= colCount; col++) {
      const cell = byPosition.get(n * 1_000 + col);
      cells.push(
        cell
          ? { value: cell.value, ...(cell.formula !== undefined ? { formula: cell.formula } : {}) }
          : { value: null }
      );
    }
    rows.push({ n, cells });
  }

  return {
    sheets,
    active: {
      index,
      name: sheet.name,
      columns,
      rowStart,
      rows,
      hasMoreRows: lastRow < sheet.rowCount,
      hasMoreColumns: sheet.colCount > SHEET_VIEW_LIMITS.maxColumns,
      sourceTruncated: sheet.truncated,
    },
  };
}

/** One sheet; every non-empty field stays the text found in the file. */
export function csvToWorkbook(rows: string[][], name: string): XlsxWorkbook {
  const cells: XlsxCell[] = [];
  let colCount = 0;
  rows.forEach((fields, r) => {
    if (fields.length > colCount) colCount = fields.length;
    fields.forEach((value, c) => {
      if (value === "") return;
      cells.push({ ref: `${columnLetters(c + 1)}${r + 1}`, row: r + 1, col: c + 1, value });
    });
  });
  return {
    sheets: [{ name, cells, rowCount: rows.length, colCount, truncated: false }],
  };
}
