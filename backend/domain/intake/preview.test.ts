import { describe, expect, it } from "vitest";
import { CSV_MIME, EVIDENCE_MIME_TYPES, XLSX_MIME, ZIP_MIME } from "../../lib/evidence";
import {
  buildSheetView,
  csvToWorkbook,
  pickDefaultPreviewDoc,
  previewModeFor,
  SHEET_VIEW_LIMITS,
} from "./preview";
import type { XlsxWorkbook } from "./xlsx";

describe("previewModeFor", () => {
  it("embeds every evidence MIME type", () => {
    for (const mime of EVIDENCE_MIME_TYPES) expect(previewModeFor(mime)).toBe("embed");
  });
  it("reads xlsx and csv as sheets", () => {
    expect(previewModeFor(XLSX_MIME)).toBe("sheet");
    expect(previewModeFor(CSV_MIME)).toBe("sheet");
  });
  it("offers download only for anything else", () => {
    expect(previewModeFor(ZIP_MIME)).toBe("none");
    expect(previewModeFor("application/x-unknown")).toBe("none");
    expect(previewModeFor(null)).toBe("none");
    expect(previewModeFor(undefined)).toBe("none");
  });
});

describe("pickDefaultPreviewDoc", () => {
  it("prefers the proforma_workbook slot", () => {
    expect(
      pickDefaultPreviewDoc([
        { id: "a", slot: "other" },
        { id: "b", slot: "proforma_workbook" },
      ])
    ).toBe("b");
  });
  it("falls back to the first document", () => {
    expect(pickDefaultPreviewDoc([{ id: "a" }, { id: "b", slot: null }])).toBe("a");
  });
  it("returns an empty string for no documents", () => {
    expect(pickDefaultPreviewDoc([])).toBe("");
  });
});

describe("buildSheetView", () => {
  it("passes formula text and value through and fills sparse gaps with null", () => {
    const wb: XlsxWorkbook = {
      sheets: [
        {
          name: "S1",
          rowCount: 3,
          colCount: 3,
          truncated: false,
          cells: [
            { ref: "A1", row: 1, col: 1, value: 5 },
            { ref: "B1", row: 1, col: 2, value: 10, formula: "A1*2" },
            { ref: "C3", row: 3, col: 3, value: "x" },
          ],
        },
      ],
    };
    const v = buildSheetView(wb, {});
    expect(v.sheets).toEqual([{ name: "S1", rowCount: 3, colCount: 3 }]);
    expect(v.active.columns).toEqual(["A", "B", "C"]);
    expect(v.active.rows.map((r) => r.n)).toEqual([1, 2, 3]);
    expect(v.active.rows[0].cells[0]).toEqual({ value: 5 });
    expect(v.active.rows[0].cells[1]).toEqual({ value: 10, formula: "A1*2" });
    expect(v.active.rows[1].cells).toEqual([{ value: null }, { value: null }, { value: null }]);
    expect(v.active.rows[2].cells[2]).toEqual({ value: "x" });
    expect(v.active.hasMoreRows).toBe(false);
    expect(v.active.hasMoreColumns).toBe(false);
  });

  it("caps columns at 100 and flags hasMoreColumns", () => {
    const wb: XlsxWorkbook = {
      sheets: [
        {
          name: "Wide",
          rowCount: 1,
          colCount: 130,
          truncated: true,
          cells: [
            { ref: "A1", row: 1, col: 1, value: "a" },
            { ref: "DX1", row: 1, col: 128, value: "far" },
          ],
        },
      ],
    };
    const v = buildSheetView(wb, {});
    expect(v.active.columns).toHaveLength(SHEET_VIEW_LIMITS.maxColumns);
    expect(v.active.columns[99]).toBe("CV");
    expect(v.active.rows[0].cells).toHaveLength(100);
    expect(v.active.hasMoreColumns).toBe(true);
    expect(v.active.sourceTruncated).toBe(true);
  });

  it("windows rows, clamps limits and reports more rows", () => {
    const wb: XlsxWorkbook = {
      sheets: [{ name: "Long", rowCount: 1000, colCount: 1, truncated: false, cells: [] }],
    };
    const def = buildSheetView(wb, {});
    expect(def.active.rows).toHaveLength(200);
    expect(def.active.hasMoreRows).toBe(true);
    const big = buildSheetView(wb, { rowLimit: 10_000 });
    expect(big.active.rows).toHaveLength(500);
    const tail = buildSheetView(wb, { rowStart: 991, rowLimit: 50 });
    expect(tail.active.rows.map((r) => r.n)[0]).toBe(991);
    expect(tail.active.rows).toHaveLength(10);
    expect(tail.active.hasMoreRows).toBe(false);
  });

  it("clamps an out-of-range sheet index and handles an empty workbook", () => {
    const wb: XlsxWorkbook = {
      sheets: [
        { name: "A", rowCount: 0, colCount: 0, truncated: false, cells: [] },
        { name: "B", rowCount: 0, colCount: 0, truncated: false, cells: [] },
      ],
    };
    expect(buildSheetView(wb, { sheetIndex: 9 }).active.name).toBe("B");
    expect(buildSheetView(wb, { sheetIndex: -3 }).active.name).toBe("A");
    const empty = buildSheetView({ sheets: [] }, {});
    expect(empty.active.rows).toEqual([]);
    expect(empty.active.name).toBe("");
  });
});

describe("csvToWorkbook", () => {
  it("keeps fields as text, skips empty fields and sizes the sheet", () => {
    const wb = csvToWorkbook(
      [
        ["a", "007", ""],
        ["1.50", "", "2024-01-02", "z"],
      ],
      "data.csv"
    );
    const s = wb.sheets[0];
    expect(wb.sheets).toHaveLength(1);
    expect(s.name).toBe("data.csv");
    expect(s.rowCount).toBe(2);
    expect(s.colCount).toBe(4);
    expect(s.truncated).toBe(false);
    expect(s.cells.map((c) => [c.ref, c.value])).toEqual([
      ["A1", "a"],
      ["B1", "007"],
      ["A2", "1.50"],
      ["C2", "2024-01-02"],
      ["D2", "z"],
    ]);
  });
  it("handles no rows", () => {
    const s = csvToWorkbook([], "e").sheets[0];
    expect(s.rowCount).toBe(0);
    expect(s.colCount).toBe(0);
    expect(s.cells).toEqual([]);
  });
});
