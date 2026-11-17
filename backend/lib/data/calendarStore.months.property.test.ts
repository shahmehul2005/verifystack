import { describe, it, expect } from "vitest";
import fc from "fast-check";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@verifystack/backend/lib/supabase/types";
import { saveCalendarReading } from "./calendarStore";

// Feature: industrial-extractor, Property 31: Month keys

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
  sourceType: "sourcing" as const,
  valueNumeric: 100,
  reviewedBy: "user-1",
};

const pad = (n: number, w: number) => String(n).padStart(w, "0");

function trueLastDay(y: number, m: number): number {
  const isLeap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const days = [31, isLeap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return days[m - 1];
}

const MONTH_KEY_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

describe("Property 31: Month keys", () => {
  /** **Validates: Requirements 12.1** */
  it("a valid YYYY-MM key maps to the first and true last day of the month", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1900, max: 2400 }),
        fc.integer({ min: 1, max: 12 }),
        async (y, m) => {
          const { client, inserted } = fakeClient();
          const key = `${pad(y, 4)}-${pad(m, 2)}`;
          const res = await saveCalendarReading(client, { ...base, monthKey: key });
          expect(res.ok).toBe(true);
          expect(inserted[0].period_kind).toBe("monthly");
          expect(inserted[0].period_start).toBe(`${key}-01`);
          expect(inserted[0].period_end).toBe(`${key}-${pad(trueLastDay(y, m), 2)}`);
        }
      ),
      { numRuns: 200 }
    );
  });

  it("February ends on the 29th in leap years and the 28th otherwise", async () => {
    for (const [key, end] of [
      ["2024-02", "2024-02-29"],
      ["2000-02", "2000-02-29"],
      ["1900-02", "1900-02-28"],
      ["2023-02", "2023-02-28"],
    ]) {
      const { client, inserted } = fakeClient();
      const res = await saveCalendarReading(client, { ...base, monthKey: key });
      expect(res.ok).toBe(true);
      expect(inserted[0].period_end).toBe(end);
    }
  });

  /** **Validates: Requirements 12.3** */
  it("any readingDate sets both period_start and period_end to that date", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.date({ min: new Date("1990-01-01"), max: new Date("2099-12-31"), noInvalidDate: true }),
        fc.oneof(
          fc.constant("2023-04"),
          fc.constant("annual"),
          fc.string({ maxLength: 10 })
        ),
        async (d, monthKey) => {
          const { client, inserted } = fakeClient();
          const readingDate = d.toISOString().slice(0, 10);
          const res = await saveCalendarReading(client, { ...base, monthKey, readingDate });
          expect(res.ok).toBe(true);
          expect(inserted[0].period_kind).toBe("daily");
          expect(inserted[0].period_start).toBe(readingDate);
          expect(inserted[0].period_end).toBe(readingDate);
        }
      ),
      { numRuns: 100 }
    );
  });

  /** **Validates: Requirements 12.4** */
  it("any other string returns ok=false, names the string, and writes nothing", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc
          .string({ maxLength: 30 })
          .filter((s) => !MONTH_KEY_RE.test(s) && s !== "annual"),
        async (monthKey) => {
          const { client, inserted } = fakeClient();
          const res = await saveCalendarReading(client, { ...base, monthKey });
          expect(res.ok).toBe(false);
          expect(res.error).toContain(monthKey);
          expect(inserted).toHaveLength(0);
        }
      ),
      { numRuns: 200 }
    );
  });

  it("near-miss month keys are rejected", async () => {
    for (const key of ["2023-00", "2023-13", "2023-4", "23-04", "2023-04-01", " 2023-04", "2023-04\n", ""]) {
      const { client, inserted } = fakeClient();
      const res = await saveCalendarReading(client, { ...base, monthKey: key });
      expect(res.ok).toBe(false);
      expect(res.error).toContain(key);
      expect(inserted).toHaveLength(0);
    }
  });
});
