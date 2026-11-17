import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { buildSheetView } from "./preview";
import { columnLetters, type CellValue, type XlsxCell, type XlsxWorkbook } from "./xlsx";

/**
 * Feature: industrial-extractor, Property 40: Sheet view reproduces the source cells
 *
 * **Validates: Requirements 20.5, 20.6, 20.7**
 */

const valueArb: fc.Arbitrary<CellValue> = fc.oneof(
  fc.string(),
  fc.double({ noNaN: true, noDefaultInfinity: true }),
  fc.integer(),
  fc.boolean(),
  fc.constant(null)
);

const sheetArb = fc
  .record({ rowCount: fc.integer({ min: 1, max: 30 }), colCount: fc.integer({ min: 1, max: 12 }) })
  .chain(({ rowCount, colCount }) =>
    fc
      .uniqueArray(
        fc.record({
          row: fc.integer({ min: 1, max: rowCount }),
          col: fc.integer({ min: 1, max: colCount }),
          value: valueArb,
          formula: fc.option(fc.string({ minLength: 1 }), { nil: undefined }),
        }),
        { selector: (c) => `${c.row}:${c.col}`, maxLength: 80 }
      )
      .map((cells) => ({ rowCount, colCount, cells }))
  );

describe("Property 40: sheet view reproduces the source cells", () => {
  it("every window cell equals the source cell, with formulas kept and gaps null", () => {
    fc.assert(
      fc.property(sheetArb, ({ rowCount, colCount, cells }) => {
        const xcells: XlsxCell[] = cells.map((c) => ({
          ref: `${columnLetters(c.col)}${c.row}`,
          row: c.row,
          col: c.col,
          value: c.value,
          ...(c.formula !== undefined ? { formula: c.formula } : {}),
        }));
        const wb: XlsxWorkbook = {
          sheets: [{ name: "S", cells: xcells, rowCount, colCount, truncated: false }],
        };
        const view = buildSheetView(wb, { sheetIndex: 0, rowStart: 1, rowLimit: 500 });

        expect(view.active.rows).toHaveLength(rowCount);
        expect(view.active.columns).toHaveLength(colCount);
        const src = new Map(xcells.map((c) => [`${c.row}:${c.col}`, c]));

        for (const row of view.active.rows) {
          expect(row.cells).toHaveLength(colCount);
          row.cells.forEach((cell, i) => {
            const s = src.get(`${row.n}:${i + 1}`);
            if (!s) {
              expect(cell).toEqual({ value: null });
              return;
            }
            expect(Object.is(cell.value, s.value)).toBe(true);
            expect(typeof cell.value).toBe(typeof s.value);
            if (s.formula !== undefined) expect(cell.formula).toBe(s.formula);
            else expect("formula" in cell).toBe(false);
          });
        }
      }),
      { numRuns: 100 }
    );
  });
});
