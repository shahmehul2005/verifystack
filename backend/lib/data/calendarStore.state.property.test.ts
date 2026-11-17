import { describe, it, expect } from "vitest";
import fc from "fast-check";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@verifystack/backend/lib/supabase/types";
import { saveCalendarReading, type ReadingMeta } from "./calendarStore";

// Feature: industrial-extractor, Property 30: Save state and reviewer fields

type Payload = Record<string, unknown>;

function fakeClient() {
  const inserted: Payload[] = [];
  const client = {
    from: () => ({
      insert: (row: Payload) => {
        inserted.push(row);
        return {
          select: () => ({ single: async () => ({ data: { id: "row-1" }, error: null }) }),
        };
      },
    }),
  } as unknown as SupabaseClient<Database>;
  return { client, inserted };
}

const base = {
  engagementId: "eng-1",
  organizationId: "org-1",
  streamKey: "clinker_production",
  monthKey: "2023-04",
  sourceType: "sourcing" as const,
  valueNumeric: 100,
};

const arbMeta: fc.Arbitrary<ReadingMeta> = fc.record(
  {
    verified: fc.boolean(),
    needsReview: fc.boolean(),
    derived: fc.boolean(),
    unitAssumed: fc.boolean(),
  },
  { requiredKeys: [] }
);

const arbReviewer = fc.option(fc.uuid(), { nil: undefined });

describe("Property 30: Save state and reviewer fields", () => {
  /** **Validates: Requirements 11.1, 11.2** */
  it("defaults to suggested with a document id and nulls reviewer fields", async () => {
    await fc.assert(
      fc.asyncProperty(fc.uuid(), arbReviewer, async (documentId, reviewedBy) => {
        const { client, inserted } = fakeClient();
        const res = await saveCalendarReading(client, { ...base, documentId, reviewedBy });
        expect(res.ok).toBe(true);
        expect(inserted).toHaveLength(1);
        expect(inserted[0].state).toBe("suggested");
        expect(inserted[0].reviewed_by).toBeNull();
        expect(inserted[0].reviewed_at).toBeNull();
      }),
      { numRuns: 100 }
    );
  });

  /** **Validates: Requirements 11.2, 11.3** */
  it("explicit suggested state always has null reviewer fields", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.option(fc.uuid(), { nil: undefined }),
        arbReviewer,
        async (documentId, reviewedBy) => {
          const { client, inserted } = fakeClient();
          const res = await saveCalendarReading(client, {
            ...base,
            documentId,
            reviewedBy,
            state: "suggested",
          });
          expect(res.ok).toBe(true);
          expect(inserted[0].state).toBe("suggested");
          expect(inserted[0].reviewed_by).toBeNull();
          expect(inserted[0].reviewed_at).toBeNull();
        }
      ),
      { numRuns: 100 }
    );
  });

  /** **Validates: Requirements 11.3, 11.4** */
  it("an accepted call without reviewedBy returns ok=false and writes nothing", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.option(fc.uuid(), { nil: undefined }),
        fc.constantFrom(undefined, null, ""),
        async (documentId, reviewedBy) => {
          const { client, inserted } = fakeClient();
          const res = await saveCalendarReading(client, {
            ...base,
            documentId,
            reviewedBy,
            state: "accepted",
          });
          expect(res.ok).toBe(false);
          expect(inserted).toHaveLength(0);
        }
      ),
      { numRuns: 50 }
    );
  });

  /** **Validates: Requirements 11.4** */
  it("an accepted call with reviewedBy records the reviewer", async () => {
    await fc.assert(
      fc.asyncProperty(fc.uuid(), async (reviewedBy) => {
        const { client, inserted } = fakeClient();
        const res = await saveCalendarReading(client, { ...base, reviewedBy, state: "accepted" });
        expect(res.ok).toBe(true);
        expect(inserted[0].state).toBe("accepted");
        expect(inserted[0].reviewed_by).toBe(reviewedBy);
        expect(inserted[0].reviewed_at).not.toBeNull();
      }),
      { numRuns: 50 }
    );
  });

  /** **Validates: Requirements 11.6** */
  it("reading_meta flags equal the flags passed in", async () => {
    await fc.assert(
      fc.asyncProperty(arbMeta, fc.uuid(), async (readingMeta, documentId) => {
        const { client, inserted } = fakeClient();
        const res = await saveCalendarReading(client, { ...base, documentId, readingMeta });
        expect(res.ok).toBe(true);
        const meta = inserted[0].reading_meta as Record<string, unknown>;
        for (const k of ["verified", "needsReview", "derived", "unitAssumed"] as const) {
          expect(meta[k]).toBe(readingMeta[k]);
        }
      }),
      { numRuns: 100 }
    );
  });
});
