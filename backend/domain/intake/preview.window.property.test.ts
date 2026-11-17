import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { buildSheetView, SHEET_VIEW_LIMITS } from "./preview";
import type { XlsxWorkbook } from "./xlsx";

// Feature: industrial-extractor, Property 41: Sheet view window is bounded and reports truncation
// **Validates: Requirements 20.10**

const numberLike = fc.oneof(
  fc.integer({ min: -1_000, max: 2_000 }),
  fc.double({ noNaN: false, min: -1e6, max: 1e6 }),
  fc.constantFrom(0, -1, NaN, Infinity, -Infinity, 1.5, Number.MAX_SAFE_INTEGER, 1e300),
  fc.constant(undefined)
);

const sheetArb = fc
  .record({
    rowCount: fc.integer({ min: 0, max: 1_200 }),
    colCount: fc.integer({ min: 0, max: 250 }),
    truncated: fc.boolean(),
  })
  .chain(({ rowCount, colCount, truncated }) =>
    fc
      .array(
        fc.record({
          row: fc.integer({ min: 1, max: Math.max(1, rowCount) }),
          col: fc.integer({ min: 1, max: Math.max(1, colCount) }),
          value: fc.oneof(fc.string(), fc.integer(), fc.constant(null)),
        }),
        { maxLength: 60 }
      )
      .map((raw) => ({
        name: "S",
        rowCount,
        colCount,
        truncated,
        cells:
          rowCount === 0 || colCount === 0
            ? []
            : raw.map((c) => ({ ref: `X${c.row}`, row: c.row, col: c.col, value: c.value })),
      }))
  );

const workbookArb = fc
  .array(sheetArb, { minLength: 1, maxLength: 3 })
  .map((sheets): XlsxWorkbook => ({ sheets }));

describe("Property 41: sheet view window bounds", () => {
  it("bounds rows and columns and reports truncation exactly", () => {
    fc.assert(
      fc.property(
        workbookArb,
        numberLike,
        numberLike,
        numberLike,
        (wb, sheetIndex, rowStart, rowLimit) => {
          const view = buildSheetView(wb, { sheetIndex, rowStart, rowLimit });
          const { active } = view;
          const sheet = wb.sheets[active.index]!;

          expect(active.rows.length).toBeLessThanOrEqual(SHEET_VIEW_LIMITS.maxRows);
          expect(active.columns.length).toBeLessThanOrEqual(SHEET_VIEW_LIMITS.maxColumns);
          for (const r of active.rows) {
            expect(r.cells.length).toBe(active.columns.length);
          }

          // An empty window means the start is past the last row, so no rows follow it.
          const expectedMore = active.rows.length
            ? sheet.rowCount > active.rows[active.rows.length - 1]!.n
            : false;
          expect(active.hasMoreRows).toBe(expectedMore);
          expect(active.hasMoreColumns).toBe(sheet.colCount > SHEET_VIEW_LIMITS.maxColumns);
          expect(active.sourceTruncated).toBe(sheet.truncated);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("returns an empty bounded view for a workbook with no sheets", () => {
    const view = buildSheetView({ sheets: [] }, { rowLimit: 10_000 });
    expect(view.active.rows).toHaveLength(0);
    expect(view.active.hasMoreRows).toBe(false);
    expect(view.active.hasMoreColumns).toBe(false);
  });
});
