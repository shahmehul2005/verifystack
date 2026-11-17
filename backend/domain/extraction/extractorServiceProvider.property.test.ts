import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type { ExtractorField, extractorClient } from "@verifystack/backend/lib/extractor/client";
import { ExtractorServiceProvider, rebuildPayload } from "./extractorServiceProvider";
import { fieldCatalogue } from "./fieldCatalogue";
import { provenanceGate } from "./provenance";
import { CONFIDENCE_POLICY, DOC_SCHEMAS, triageFields } from "./schemas";
import type { DocumentPage } from "./provider";

/**
 * Feature: industrial-extractor, Property 35: Provider rebuild keeps review routing
 * **Validates: Requirements 14.3, 14.6, 17.3**
 */

const DOC_TYPES = Object.keys(DOC_SCHEMAS) as (keyof typeof DOC_SCHEMAS)[];

const page: DocumentPage = {
  evidenceId: "ev-1",
  pageNumber: 3,
  mimeType: "image/png",
  data: Buffer.from("x").toString("base64"),
};

const bboxArb = fc.record({
  x: fc.double({ min: 0, max: 1, noNaN: true }),
  y: fc.double({ min: 0, max: 1, noNaN: true }),
  width: fc.double({ min: 0, max: 1, noNaN: true }),
  height: fc.double({ min: 0, max: 1, noNaN: true }),
});

/** Fields for every catalogue path of a doc type; `*` expands to indices 0..n-1. */
function fieldsArb(docType: keyof typeof DOC_SCHEMAS): fc.Arbitrary<ExtractorField[]> {
  const entries = fieldCatalogue(DOC_SCHEMAS[docType]);
  return fc.integer({ min: 1, max: 3 }).chain((n) => {
    const paths = entries.flatMap((e) => {
      const stars = e.path.split("*").length - 1;
      if (stars === 0) return [e];
      // one star level is enough for the catalogue; expand it to n indices
      return Array.from({ length: n }, (_, i) => ({ ...e, path: e.path.replace(/\*/g, String(i)) }));
    });
    return fc.tuple(
      ...paths.map((e) =>
        fc
          .record({
            value: fc.oneof(
              fc.double({ min: 0, max: 1e6, noNaN: true }),
              fc.string({ minLength: 1, maxLength: 12 }),
            ),
            confidence: fc.double({ min: 0, max: 1, noNaN: true }),
            needs_review: fc.boolean(),
            regulatory: fc.boolean(),
            sourceText: fc.string({ minLength: 1, maxLength: 20 }),
            bbox: fc.option(bboxArb, { nil: null }),
            unit: fc.option(fc.string({ maxLength: 5 }), { nil: null }),
          })
          .map(
            (r): ExtractorField => ({
              path: e.path,
              kind: e.kind,
              value: r.value,
              unit_as_printed: r.unit,
              confidence: r.confidence,
              verified: false,
              needs_review: r.needs_review,
              regulatory: r.regulatory || e.regulatory === true,
              review_reasons: [],
              provenance: {
                page: 99, // service page is ignored; the caller's page wins
                bbox: r.bbox,
                sheet: null,
                cell: null,
                source_text: r.sourceText,
                formula: null,
              },
            }),
          ),
      ),
    );
  });
}

function pick(root: unknown, path: string): Record<string, unknown> | undefined {
  let node: unknown = root;
  for (const seg of path.split(".")) {
    if (node === null || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[seg];
  }
  return node as Record<string, unknown> | undefined;
}

describe("Property 35: provider rebuild keeps review routing", () => {
  it("keeps every path and routes needs_review/regulatory fields to human_review", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...DOC_TYPES).chain((d) => fieldsArb(d)),
        (fields) => {
          const payload = rebuildPayload(fields, page);
          const decisions = new Map(triageFields(payload).map((d) => [d.fieldPath, d]));
          for (const f of fields) {
            const leaf = pick(payload, f.path);
            expect(leaf).toBeDefined();
            expect(leaf!.value).toBe(f.value);
            expect((leaf!.provenance as { page: number }).page).toBe(page.pageNumber);
            if (f.needs_review || f.regulatory) {
              expect(leaf!.confidence as number).toBeLessThan(CONFIDENCE_POLICY.reviewBelow);
              expect(decisions.get(f.path)?.action).toBe("human_review");
            } else {
              expect(leaf!.confidence).toBe(f.confidence);
            }
            // every rebuilt leaf carries page, box and source text, so the gate passes it
            const p = leaf!.provenance as { page: number; bbox: never; sourceText: string };
            expect(provenanceGate({ fieldPath: f.path, ...p }).ok).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("provenanceGate drops any leaf missing page, box or source text", () => {
    fc.assert(
      fc.property(
        bboxArb,
        fc.string({ minLength: 1, maxLength: 10 }),
        fc.constantFrom("page", "bbox", "sourceText"),
        (bbox, sourceText, drop) => {
          const input = { fieldPath: "f", page: 1, bbox, sourceText } as Record<string, unknown>;
          delete input[drop];
          expect(provenanceGate(input as never).ok).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("extract() sends the catalogue and rebuilds the service fields without network", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...DOC_TYPES).chain((d) => fieldsArb(d).map((f) => [d, f] as const)),
        async ([docType, fields]) => {
          let sent: unknown;
          const fake = {
            extractFields: async (input: { catalogue: unknown }) => {
              sent = input.catalogue;
              return {
                ok: true,
                data: {
                  ok: true,
                  fields,
                  run: {
                    prompt_version: "pv",
                    model: "m",
                    model_calls: 1,
                    duration_ms: 1,
                    input_hash: "h",
                  },
                },
              };
            },
          } as unknown as typeof extractorClient;
          const provider = new ExtractorServiceProvider(fake);
          const res = await provider.extract(page, docType, DOC_SCHEMAS[docType]);
          expect(sent).toEqual(fieldCatalogue(DOC_SCHEMAS[docType]));
          expect(res.log.ok).toBe(true);
        },
      ),
      { numRuns: 30 },
    );
  });
});
