import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { openZip } from "../archive/zip";
import { parseXlsx, type XlsxCell, type XlsxSheet } from "./xlsx";
import { scanSheetForSummaries, suggestFieldPath, summaryHeadline, unitFromHeader } from "./summary";

function colLetters(n: number): string {
  let s = "";
  let x = n;
  while (x > 0) {
    const r = (x - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
}

type Cell = string | number | null | { v: string | number | null; f: string };

/** A sheet from a grid of literals and { v, f } formula cells. Row 1 is the first row. */
function sheetFrom(rows: Cell[][], name = "Sheet1"): XlsxSheet {
  const cells: XlsxCell[] = [];
  rows.forEach((row, r) =>
    row.forEach((raw, c) => {
      if (raw === null) return;
      const isFormula = typeof raw === "object";
      const value = isFormula ? raw.v : raw;
      cells.push({
        ref: `${colLetters(c + 1)}${r + 1}`,
        row: r + 1,
        col: c + 1,
        value,
        ...(isFormula ? { formula: raw.f } : {}),
      });
    })
  );
  return {
    name,
    cells,
    rowCount: rows.length,
    colCount: Math.max(0, ...rows.map((r) => r.length)),
    truncated: false,
  };
}

const header = ["Date", "Clinker Production (t)", "Kiln Run Status"];

describe("scanSheetForSummaries: finding the table", () => {
  it("finds the header, the data rows and a keyword TOTAL row, and matches a typed total to its rows", () => {
    const sheet = sheetFrom([
      ["Plant report"],
      [],
      header,
      ["2023-11-01", 400.5, "RUN"],
      ["2023-11-02", 399.5, "RUN"],
      ["TOTAL", 800, null],
    ]);
    const [c] = scanSheetForSummaries(sheet);
    expect(c).toBeDefined();
    expect(c!.totalRow).toBe(6);
    expect(c!.headerRow).toBe(3);
    expect(c!.dataRowCount).toBe(2);
    expect(c!.totalKind).toBe("keyword");
    expect(c!.drafts).toHaveLength(1);
    const d = c!.drafts[0]!;
    expect(d.cellRef).toBe("B6");
    expect(d.status).toBe("matches");
    expect(d.cachedValue).toBe(800);
    expect(d.recomputed).toBe(800);
    expect(d.preferredSource).toBe("cached");
    expect(d.preferredValue).toBe(800);
  });

  it("does not take a header such as 'Gross Generation (kWh)' for a total row", () => {
    const sheet = sheetFrom([
      ["Date", "Gross Generation (kWh)"],
      ["2023-11-01", 28000],
      ["2023-11-02", 30000],
    ]);
    // The header is not a total row. The column is summed here instead, as a computed candidate.
    expect(scanSheetForSummaries(sheet).filter((c) => c.source === "total_row")).toEqual([]);
  });

  it("finds no total row in a sheet that has none", () => {
    const found = scanSheetForSummaries(sheetFrom([header, ["2023-11-01", 1, "RUN"]]));
    expect(found.filter((c) => c.source === "total_row")).toEqual([]);
  });

  it("handles 120 data rows, the multi-row case the spec names", () => {
    const rows: Cell[][] = [header];
    let sum = 0;
    for (let i = 1; i <= 120; i++) {
      rows.push([`row-${i}`, i, "RUN"]);
      sum += i;
    }
    rows.push(["Total", sum, null]);
    const [c] = scanSheetForSummaries(sheetFrom(rows));
    expect(c!.dataRowCount).toBe(120);
    expect(c!.drafts[0]!.status).toBe("matches");
  });

  it("returns one candidate per total row and says which one it is", () => {
    const sheet = sheetFrom([
      header,
      ["a", 1, "RUN"],
      ["Total", 1, null],
      ["b", 2, "RUN"],
      ["Grand total", 3, null],
    ]);
    const all = scanSheetForSummaries(sheet);
    expect(all.map((c) => c.totalRow)).toEqual([3, 5]);
    expect(all[1]!.notes.join(" ")).toMatch(/2 total rows/);
  });
});

describe("scanSheetForSummaries: checking totals", () => {
  it("allows a difference that one-decimal rounding can explain, and labels it so", () => {
    // Three one-decimal values sum to 6.2; the total cell says 6.3. Allowance = (3+1) × 0.05 = 0.2.
    const sheet = sheetFrom([
      ["Date", "Output (t)"],
      ["d1", 2.1],
      ["d2", 2.1],
      ["d3", 2.0],
      ["Total", 6.3],
    ]);
    const d = scanSheetForSummaries(sheet)[0]!.drafts[0]!;
    expect(d.recomputed).toBe(6.2);
    expect(d.difference).toBeCloseTo(0.1, 9);
    expect(d.status).toBe("rounding");
  });

  it("refuses rounding on an integer column: a one-unit gap is a difference", () => {
    const sheet = sheetFrom([
      ["Date", "Units"],
      ["d1", 10],
      ["d2", 20],
      ["Total", 31],
    ]);
    const d = scanSheetForSummaries(sheet)[0]!.drafts[0]!;
    expect(d.status).toBe("differs");
    expect(d.difference).toBe(1);
    expect(scanSheetForSummaries(sheet)[0]!.notes.join(" ")).toMatch(/differ/);
  });

  it("recomputes a SUM formula from its range, and matches when the stored result agrees", () => {
    const sheet = sheetFrom([
      ["Date", "Output (t)"],
      ["d1", 10],
      ["d2", 5],
      ["Total", { v: 15, f: "SUM(B2:B3)" }],
    ]);
    const d = scanSheetForSummaries(sheet)[0]!.drafts[0]!;
    expect(d.formula).toBe("SUM(B2:B3)");
    expect(d.recomputedFrom).toBe("B2:B3 (2 numbers)");
    expect(d.status).toBe("matches");
  });

  it("flags a formula whose result was never stored (cached 0), and offers the recomputed sum", () => {
    const sheet = sheetFrom([
      ["Date", "Output (t)"],
      ["d1", 10],
      ["d2", 5],
      ["Total", { v: 0, f: "SUM(B2:B3)" }],
    ]);
    const c = scanSheetForSummaries(sheet)[0]!;
    const d = c.drafts[0]!;
    expect(d.status).toBe("not_stored");
    expect(d.preferredSource).toBe("recomputed");
    expect(d.preferredValue).toBe(15);
    expect(c.notes.join(" ")).toMatch(/not stored/);
  });

  it("accepts SUBTOTAL(9, range) and does not recompute other SUBTOTAL codes from the range", () => {
    const nine = sheetFrom([
      ["Date", "Output (t)"],
      ["d1", 3],
      ["d2", 4],
      ["Total", { v: 7, f: "SUBTOTAL(9,B2:B3)" }],
    ]);
    expect(scanSheetForSummaries(nine)[0]!.drafts[0]!.status).toBe("matches");

    const average = sheetFrom([
      ["Date", "Output (t)"],
      ["d1", 3],
      ["d2", 4],
      ["Total", { v: 3.5, f: "SUBTOTAL(1,B2:B3)" }],
    ]);
    const c = scanSheetForSummaries(average)[0]!;
    expect(c.drafts[0]!.recomputedFrom).toBe("2 data rows above");
    expect(c.notes.join(" ")).toMatch(/does not recompute/);
  });
});

describe("headers, units and tags", () => {
  it("reads the unit from the last bracket and returns null when there is none", () => {
    expect(unitFromHeader("Clinker Production (t)")).toBe("t");
    expect(unitFromHeader("Gross Generation (kWh)")).toBe("kWh");
    expect(unitFromHeader("Kiln Run Status")).toBeNull();
  });

  it("suggests a pack target when most of its words are in the header, else a slug from the header", () => {
    const targets = [{ path: "production", label: "Cement equivalent product" }];
    expect(suggestFieldPath("Equivalent product (t)", targets)).toEqual({ fieldPath: "production", basis: "pack_target" });
    expect(suggestFieldPath("Clinker Production (t)", targets)).toEqual({ fieldPath: "clinker_production", basis: "header" });
  });

  it("uses the pack target as the suggested tag when the header matches one", () => {
    const sheet = sheetFrom([
      ["Date", "Cement equivalent product (t)"],
      ["d1", 10],
      ["Total", 10],
    ]);
    const [c] = scanSheetForSummaries(sheet, { targets: [{ path: "production", label: "Cement equivalent product" }] });
    expect(c!.drafts[0]).toMatchObject({ suggestedFieldPath: "production", tagBasis: "pack_target", suggestedUnit: "t" });
  });
});

describe("coverage and headline", () => {
  it("reads the period from a date column, so a monthly total can be told from an annual one", () => {
    const sheet = sheetFrom([
      ["Date", "Output (t)"],
      ["2023-11-02", 1],
      ["2023-11-01", 1],
      ["2023-11-30", 1],
      ["Total", 3],
    ]);
    const [c] = scanSheetForSummaries(sheet);
    expect(c!.coverage).toEqual({ rows: 3, first: "2023-11-01", last: "2023-11-30" });
    expect(summaryHeadline([c!])).toMatchObject({
      totals: 1,
      candidates: [expect.objectContaining({ key: "total:5", source: "total_row", headerRow: 1, dataRowCount: 3, drafts: 1 })],
    });
  });

  it("names columns by letter when no header row exists", () => {
    const sheet = sheetFrom([
      [1, 2],
      [3, 4],
      ["Total", 4],
    ]);
    const c = scanSheetForSummaries(sheet)[0]!;
    expect(c.headerRow).toBeNull();
    expect(c.drafts[0]!.suggestedFieldPath).toBe("column_b");
  });
});

describe("Shyamrock test set: SCADA production trend", () => {
  const ZIP = path.resolve(process.cwd(), "do-res", "shyamrock_cement_works.zip");
  it.skipIf(!existsSync(ZIP))("finds the TOTAL row, sums the 30 days, and marks the one-decimal columns as rounding", () => {
    const zip = openZip(new Uint8Array(readFileSync(ZIP)));
    const sheet = parseXlsx(zip.read("01_scada_production_trend.xlsx")).sheets[0]!;
    const [c] = scanSheetForSummaries(sheet);
    expect(c).toBeDefined();
    expect(c!.totalRow).toBe(36);
    expect(c!.headerRow).toBe(5);
    expect(c!.dataRowCount).toBe(30);
    expect(c!.coverage).toEqual({ rows: 30, first: "2023-11-01", last: "2023-11-30" });

    const byHeader = Object.fromEntries(c!.drafts.map((d) => [d.header, d]));
    expect(byHeader["Clinker Production (t)"]!.status).toBe("matches");
    expect(byHeader["Clinker Production (t)"]!.recomputed).toBe(12500);
    expect(byHeader["OPC Produced (t)"]!.status).toBe("rounding");
    expect(byHeader["PPC Produced (t)"]!.status).toBe("rounding");
    expect(byHeader["PSC Produced (t)"]!.status).toBe("rounding");
    expect(byHeader["Clinker Production (t)"]!.suggestedUnit).toBe("t");
  });
});
