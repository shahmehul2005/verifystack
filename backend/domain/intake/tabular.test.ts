import { describe, expect, it } from "vitest";
import {
  CellReadError,
  PREVIEW_COLS,
  PREVIEW_ROWS,
  csvCellValue,
  csvToSheet,
  previewSheet,
  readCell,
  sheetToTable,
  sheetsFromBytes,
} from "./tabular";

describe("csvCellValue", () => {
  it("reads plain and comma-grouped numbers, leaves text and blanks", () => {
    expect(csvCellValue("1,234.5")).toBe(1234.5);
    expect(csvCellValue(" -12 ")).toBe(-12);
    expect(csvCellValue("1e3")).toBe(1000);
    expect(csvCellValue("12 kWh")).toBe("12 kWh");
    expect(csvCellValue("1,23")).toBe("1,23");
    expect(csvCellValue("   ")).toBeNull();
  });
});

describe("csvToSheet and readCell", () => {
  const sheet = csvToSheet("bill", [
    ["Item", "Qty"],
    ["Coal", "1,250"],
    ["", ""],
  ]);

  it("addresses cells positionally and skips blanks", () => {
    expect(sheet.rowCount).toBe(3);
    expect(sheet.cells.map((c) => c.ref)).toEqual(["A1", "B1", "A2", "B2"]);
    expect(readCell([sheet], "bill", "B2")).toEqual({ sheet: "bill", cellRef: "B2", value: 1250 });
  });

  it("refuses an empty cell or an unknown sheet", () => {
    expect(() => readCell([sheet], "bill", "A3")).toThrow(CellReadError);
    expect(() => readCell([sheet], "other", "A1")).toThrow(/no sheet/);
  });
});

describe("previewSheet", () => {
  it("caps the preview and says it was cut", () => {
    const rows = Array.from({ length: 100 }, (_, r) =>
      Array.from({ length: 30 }, (_, c) => `${r * 100 + c}`)
    );
    const p = previewSheet(csvToSheet("big", rows));
    expect(p.rows).toHaveLength(PREVIEW_ROWS);
    expect(p.rows[0]).toHaveLength(PREVIEW_COLS);
    expect(p.truncated).toBe(true);
    expect(p.rowCount).toBe(100);
  });
});

describe("sheetsFromBytes", () => {
  it("names a CSV sheet after the file without its extension", () => {
    const bytes = new TextEncoder().encode("a,b\n1,2\n");
    const sheets = sheetsFromBytes(bytes, "csv", "Plant Meter.csv");
    expect(sheets).toHaveLength(1);
    expect(sheets[0]!.name).toBe("Plant Meter");
  });
});

describe("sheetToTable", () => {
  it("returns a full grid with empty strings for empty cells", () => {
    const sheet = csvToSheet("S", [
      ["a", "b", "c"],
      ["1", "", "3"],
    ]);
    expect(sheetToTable(sheet)).toEqual([
      ["a", "b", "c"],
      ["1", "", "3"],
    ]);
  });
});
