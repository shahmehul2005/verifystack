import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { CSV_MIME, EVIDENCE_MIME_TYPES, XLSX_MIME } from "../../lib/evidence";
import { previewModeFor } from "./preview";

/**
 * Property 42: Preview mode never frames a spreadsheet or an unknown type
 * **Validates: Requirements 20.1, 20.2, 20.3, 20.4**
 */
describe("Property 42: previewModeFor", () => {
  const known = new Set<string>([...EVIDENCE_MIME_TYPES, XLSX_MIME, CSV_MIME]);

  it("has exactly four evidence MIME types", () => {
    expect(EVIDENCE_MIME_TYPES).toHaveLength(4);
  });

  it("returns embed only for the evidence types, sheet only for XLSX/CSV, none otherwise", () => {
    const mimes = fc.oneof(
      fc.string(),
      fc.constantFrom(...known),
      fc.constantFrom(...known).map((m) => m.toUpperCase()),
      fc.constantFrom(...known).map((m) => ` ${m}`),
      fc.constantFrom(null, undefined, "")
    );
    fc.assert(
      fc.property(mimes, (mime) => {
        const mode = previewModeFor(mime);
        const isEvidence = (EVIDENCE_MIME_TYPES as readonly string[]).includes(mime ?? "");
        const isSheet = mime === XLSX_MIME || mime === CSV_MIME;
        expect(mode === "embed").toBe(isEvidence);
        expect(mode === "sheet").toBe(isSheet);
        expect(mode === "none").toBe(!isEvidence && !isSheet);
      }),
      { numRuns: 300 }
    );
  });

  it("maps each known type to its expected mode", () => {
    for (const m of EVIDENCE_MIME_TYPES) expect(previewModeFor(m)).toBe("embed");
    expect(previewModeFor(XLSX_MIME)).toBe("sheet");
    expect(previewModeFor(CSV_MIME)).toBe("sheet");
  });
});
