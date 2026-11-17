import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { pickDefaultPreviewDoc } from "./preview";

// Feature: industrial-extractor, Property 43: Default preview document
// **Validates: Requirements 20.14**

const slotArb = fc.option(
  fc.oneof(
    fc.constant("proforma_workbook"),
    fc.constantFrom("evidence", "monitoring_plan", "other"),
    fc.string({ maxLength: 12 })
  ),
  { nil: undefined }
);

const docsArb = fc
  .uniqueArray(fc.uuid(), { maxLength: 12 })
  .chain((ids) =>
    fc
      .array(fc.oneof(slotArb, fc.constant(null)), {
        minLength: ids.length,
        maxLength: ids.length,
      })
      .map((slots) => ids.map((id, i) => ({ id, slot: slots[i] })))
  );

describe("Property 43: Default preview document", () => {
  it("picks a proforma_workbook document, else the first, else an empty string", () => {
    fc.assert(
      fc.property(docsArb, (docs) => {
        const result = pickDefaultPreviewDoc(docs);
        if (docs.length === 0) {
          expect(result).toBe("");
          return;
        }
        const proforma = docs.filter((d) => d.slot === "proforma_workbook");
        if (proforma.length > 0) {
          const picked = docs.find((d) => d.id === result);
          expect(picked?.slot).toBe("proforma_workbook");
        } else {
          expect(result).toBe(docs[0].id);
        }
      }),
      { numRuns: 200 }
    );
  });

  it("returns an empty string for an empty list", () => {
    expect(pickDefaultPreviewDoc([])).toBe("");
  });
});
