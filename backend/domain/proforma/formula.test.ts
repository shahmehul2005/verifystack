import { describe, expect, it } from "vitest";
import type { XlsxWorkbook } from "../intake/xlsx";
import { evaluateWorkbook } from "./formula";

function wb(): XlsxWorkbook {
  const c = (sheet: string, ref: string, value: number | string | null, formula?: string) => {
    const m = /^([A-Z]+)(\d+)$/.exec(ref)!;
    return { ref, row: Number(m[2]), col: m[1]!.charCodeAt(0) - 64, value, ...(formula ? { formula } : {}) };
  };
  return {
    sheets: [
      {
        name: "1_Production",
        cells: [c("", "A1", "a"), c("", "B1", 2), c("", "B2", 3), c("", "B3", 0, "B1*B2+4"), c("", "B4", 0, "SUM(B1:B3)")],
        rowCount: 4,
        colCount: 2,
        truncated: false,
      },
      {
        name: "Sum mary",
        cells: [c("", "B1", 0, "'1_Production'!B3*100000"), c("", "B2", 0, "B1/0"), c("", "B3", 0, "-(B1+1)/2"), c("", "B4", 0, "FOO(1)")],
        rowCount: 4,
        colCount: 2,
        truncated: false,
      },
    ],
  };
}

describe("workbook formula evaluator", () => {
  const ev = evaluateWorkbook(wb());

  it("recomputes formulas whose stored result is 0", () => {
    expect(ev.value("1_Production", "B3")).toBe(10);
    expect(ev.value("1_Production", "B4")).toBe(15);
  });

  it("follows references across sheets and handles unary minus and parentheses", () => {
    expect(ev.value("Sum mary", "B1")).toBe(1_000_000);
    expect(ev.value("Sum mary", "B3")).toBe(-500_000.5);
  });

  it("reports an error and no value for division by zero and unsupported functions", () => {
    expect(ev.value("Sum mary", "B2")).toBeNull();
    expect(ev.value("Sum mary", "B4")).toBeNull();
    const errs = ev.formulaCells.filter((f) => f.error).map((f) => f.ref);
    expect(errs).toEqual(expect.arrayContaining(["B2", "B4"]));
  });
});
