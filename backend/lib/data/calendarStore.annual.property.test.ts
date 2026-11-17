import { describe, it, expect } from "vitest";
import fc from "fast-check";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@verifystack/backend/lib/supabase/types";
import { saveCalendarReading } from "./calendarStore";

// Feature: industrial-extractor, Property 32: Annual window from the compliance year

type Payload = Record<string, unknown>;

/** Fake client: the engagement lookup returns `label`; inserts are recorded. */
function fakeClient(label: string | null) {
  const inserted: Payload[] = [];
  let engagementReads = 0;
  const client = {
    from: (table: string) => {
      if (table === "engagements") {
        const chain = {
          select: () => chain,
          eq: () => chain,
          maybeSingle: async () => {
            engagementReads++;
            return { data: label === null ? null : { compliance_year: label }, error: null };
          },
        };
        return chain;
      }
      return {
        insert: (row: Payload) => {
          inserted.push(row);
          return {
            select: () => ({ single: async () => ({ data: { id: "row-1" }, error: null }) }),
          };
        },
      };
    },
  } as unknown as SupabaseClient<Database>;
  return { client, inserted, reads: () => engagementReads };
}

const base = {
  engagementId: "eng-1",
  organizationId: "org-1",
  streamKey: "clinker_production",
  monthKey: "annual",
  sourceType: "sourcing" as const,
  valueNumeric: 100,
  // A document id keeps the state "suggested", so no reviewer is needed and
  // any ok=false below comes from the annual window, not the reviewer check.
  documentId: "doc-1",
};

const arbStart = fc.integer({ min: 2000, max: 2098 });

const arbValidLabel = arbStart.chain((y) => {
  const short = String((y + 1) % 100).padStart(2, "0");
  return fc.constantFrom(
    { y, label: `FY${y}-${short}` },
    { y, label: `${y}-${short}` },
    { y, label: `FY ${y}-${y + 1}` }
  );
});

const arbInvalidLabel = fc.oneof(
  fc.constantFrom("", "annual", "unknown", "FY", "2023", "FYxx-yy"),
  // Two-digit end year that is not the start year plus one.
  fc
    .tuple(arbStart, fc.integer({ min: 0, max: 99 }))
    .filter(([y, e]) => e !== (y + 1) % 100)
    .map(([y, e]) => `FY${y}-${String(e).padStart(2, "0")}`)
);

describe("Property 32: Annual window from the compliance year", () => {
  /** **Validates: Requirements 12.2** */
  it("a passed label gives 1 April to 31 March and skips the engagement lookup", async () => {
    await fc.assert(
      fc.asyncProperty(arbValidLabel, async ({ y, label }) => {
        const { client, inserted, reads } = fakeClient("garbage");
        const res = await saveCalendarReading(client, { ...base, complianceYear: label });
        expect(res.ok).toBe(true);
        expect(inserted[0].period_kind).toBe("annual");
        expect(inserted[0].period_start).toBe(`${y}-04-01`);
        expect(inserted[0].period_end).toBe(`${y + 1}-03-31`);
        expect(reads()).toBe(0);
      }),
      { numRuns: 100 }
    );
  });

  /** **Validates: Requirements 12.2** */
  it("reads the label from the engagement row when the caller omits it", async () => {
    await fc.assert(
      fc.asyncProperty(arbValidLabel, async ({ y, label }) => {
        const { client, inserted, reads } = fakeClient(label);
        const res = await saveCalendarReading(client, base);
        expect(res.ok).toBe(true);
        expect(reads()).toBe(1);
        expect(inserted[0].period_start).toBe(`${y}-04-01`);
        expect(inserted[0].period_end).toBe(`${y + 1}-03-31`);
      }),
      { numRuns: 100 }
    );
  });

  /** **Validates: Requirements 12.2** */
  it("a label that does not parse returns ok=false and writes nothing", async () => {
    await fc.assert(
      fc.asyncProperty(arbInvalidLabel, fc.boolean(), async (label, passed) => {
        const { client, inserted } = fakeClient(label);
        const res = await saveCalendarReading(
          client,
          passed ? { ...base, complianceYear: label } : base
        );
        expect(res.ok).toBe(false);
        expect(res.error).toMatch(/compliance year/);
        expect(inserted).toHaveLength(0);
      }),
      { numRuns: 100 }
    );
  });

  /** **Validates: Requirements 12.2** */
  it("a missing engagement row returns ok=false", async () => {
    const { client, inserted } = fakeClient(null);
    const res = await saveCalendarReading(client, base);
    expect(res.ok).toBe(false);
    expect(inserted).toHaveLength(0);
  });
});
