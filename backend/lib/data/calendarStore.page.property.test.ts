import { describe, it, expect, vi } from "vitest";
import fc from "fast-check";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@verifystack/backend/lib/supabase/types";

vi.mock("server-only", () => ({}));

import { saveCalendarReading } from "./calendarStore";

// Feature: industrial-extractor, Property 33: Null page stays null

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
  reviewedBy: "00000000-0000-4000-8000-000000000001",
};

const arbNoPage = fc.constantFrom<number | null | undefined>(undefined, null);

const arbBbox = fc.option(
  fc.record(
    {
      x: fc.double({ min: 0, max: 1000, noNaN: true }),
      y: fc.double({ min: 0, max: 1000, noNaN: true }),
      width: fc.double({ min: 0, max: 1000, noNaN: true }),
      height: fc.double({ min: 0, max: 1000, noNaN: true }),
      sheet: fc.string({ minLength: 1, maxLength: 20 }),
      cellRef: fc.string({ minLength: 1, maxLength: 10 }),
    },
    { requiredKeys: [] }
  ),
  { nil: null }
);

describe("Property 33: Null page stays null", () => {
  /** **Validates: Requirements 12.5** */
  it("a save without a page stores null page, null bbox and a non-AI extraction method", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbNoPage,
        arbBbox,
        fc.option(fc.uuid(), { nil: undefined }),
        fc.constantFrom(undefined, "workbook_reader" as const, "manual_entry" as const),
        fc.constantFrom<"suggested" | "accepted" | undefined>(undefined, "suggested", "accepted"),
        async (provenancePage, provenanceBbox, documentId, extractionMethod, state) => {
          const { client, inserted } = fakeClient();
          const res = await saveCalendarReading(client, {
            ...base,
            provenancePage,
            provenanceBbox,
            documentId,
            extractionMethod,
            state,
          });
          expect(res.ok).toBe(true);
          expect(inserted).toHaveLength(1);
          expect(inserted[0].provenance_page).toBeNull();
          expect(inserted[0].provenance_bbox).toBeNull();
          expect(inserted[0].extraction_method).not.toBe("ai_extraction");
        }
      ),
      { numRuns: 100 }
    );
  });
});
