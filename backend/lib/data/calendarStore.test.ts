import { describe, it, expect, vi, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@verifystack/backend/lib/supabase/types";
import { saveCalendarReading } from "./calendarStore";

type Row = Record<string, unknown>;

/** Mock client: records the engagement lookup and the CEV insert. */
function makeSupabase(opts: {
  complianceYear?: string | null;
  insertError?: string;
} = {}) {
  const inserts: Row[] = [];
  const engEq: Array<[string, unknown]> = [];
  let engQueried = false;

  const client = {
    from: vi.fn((table: string) => {
      if (table === "engagements") {
        engQueried = true;
        const q: Record<string, unknown> = {};
        q.select = vi.fn(() => q);
        q.eq = vi.fn((col: string, val: unknown) => {
          engEq.push([col, val]);
          return q;
        });
        q.maybeSingle = vi.fn().mockResolvedValue({
          data:
            opts.complianceYear === null
              ? null
              : { compliance_year: opts.complianceYear ?? "FY2025-26" },
        });
        return q;
      }
      if (table === "canonical_evidence_values") {
        return {
          insert: vi.fn((row: Row) => {
            inserts.push(row);
            return {
              select: vi.fn(() => ({
                single: vi.fn().mockResolvedValue(
                  opts.insertError
                    ? { data: null, error: { message: opts.insertError } }
                    : { data: { id: "cev-1" }, error: null },
                ),
              })),
            };
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    }),
  };

  return {
    supabase: client as unknown as SupabaseClient<Database>,
    inserts,
    engEq,
    engQueried: () => engQueried,
  };
}

const base = {
  engagementId: "eng-1",
  organizationId: "org-1",
  streamKey: "coal_quantity",
  monthKey: "2025-04",
  sourceType: "sourcing" as const,
  valueNumeric: 100,
  unit: "t",
};

afterEach(() => {
  vi.useRealTimers();
});

describe("saveCalendarReading - state and reviewer fields", () => {
  it("defaults to suggested with null reviewer fields when a document is attached", async () => {
    const m = makeSupabase();
    const res = await saveCalendarReading(m.supabase, {
      ...base,
      documentId: "doc-1",
      reviewedBy: "user-1",
    });
    expect(res).toEqual({ ok: true, id: "cev-1" });
    expect(m.inserts[0].state).toBe("suggested");
    expect(m.inserts[0].reviewed_by).toBeNull();
    expect(m.inserts[0].reviewed_at).toBeNull();
  });

  it("defaults to accepted with reviewer fields when no document is attached", async () => {
    const m = makeSupabase();
    const res = await saveCalendarReading(m.supabase, { ...base, reviewedBy: "user-1" });
    expect(res.ok).toBe(true);
    expect(m.inserts[0].state).toBe("accepted");
    expect(m.inserts[0].reviewed_by).toBe("user-1");
    expect(typeof m.inserts[0].reviewed_at).toBe("string");
  });

  it("returns ok=false and does not insert when accepted has no reviewedBy", async () => {
    const m = makeSupabase();
    const res = await saveCalendarReading(m.supabase, { ...base });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/reviewedBy/);
    expect(m.inserts).toHaveLength(0);
  });

  it("honours an explicit accepted state with a document", async () => {
    const m = makeSupabase();
    const res = await saveCalendarReading(m.supabase, {
      ...base,
      documentId: "doc-1",
      state: "accepted",
      reviewedBy: "user-1",
    });
    expect(res.ok).toBe(true);
    expect(m.inserts[0].state).toBe("accepted");
    expect(m.inserts[0].reviewed_by).toBe("user-1");
  });

  it("nulls reviewer fields for an explicit suggested state even with reviewedBy", async () => {
    const m = makeSupabase();
    await saveCalendarReading(m.supabase, { ...base, state: "suggested", reviewedBy: "user-1" });
    expect(m.inserts[0].state).toBe("suggested");
    expect(m.inserts[0].reviewed_by).toBeNull();
    expect(m.inserts[0].reviewed_at).toBeNull();
  });
});

describe("saveCalendarReading - period dates", () => {
  it.each([
    ["2025-04", "2025-04-30"],
    ["2025-01", "2025-01-31"],
    ["2023-02", "2023-02-28"],
    ["2024-02", "2024-02-29"],
    ["2100-02", "2100-02-28"],
    ["2000-02", "2000-02-29"],
    ["2025-12", "2025-12-31"],
  ])("monthly %s ends on %s", async (monthKey, end) => {
    const m = makeSupabase();
    const res = await saveCalendarReading(m.supabase, { ...base, monthKey, reviewedBy: "u" });
    expect(res.ok).toBe(true);
    expect(m.inserts[0].period_kind).toBe("monthly");
    expect(m.inserts[0].period_start).toBe(`${monthKey}-01`);
    expect(m.inserts[0].period_end).toBe(end);
    expect(m.engQueried()).toBe(false);
  });

  it("uses readingDate for a daily reading and encodes it in the canonical key", async () => {
    const m = makeSupabase();
    await saveCalendarReading(m.supabase, {
      ...base,
      readingDate: "2025-05-12",
      reviewedBy: "u",
    });
    expect(m.inserts[0].period_kind).toBe("daily");
    expect(m.inserts[0].period_start).toBe("2025-05-12");
    expect(m.inserts[0].period_end).toBe("2025-05-12");
    expect(m.inserts[0].canonical_key).toBe("coal_quantity#sourcing#2025-05-12");
  });

  it("uses the plain canonical key and registry version without a readingDate", async () => {
    const m = makeSupabase();
    await saveCalendarReading(m.supabase, { ...base, reviewedBy: "u" });
    expect(m.inserts[0].canonical_key).toBe("coal_quantity#sourcing");
    expect(m.inserts[0].registry_version).toBe("source_type:sourcing");
  });
});

describe("saveCalendarReading - annual window", () => {
  it("reads compliance_year from the engagement, scoped by organization", async () => {
    const m = makeSupabase({ complianceYear: "FY2025-26" });
    const res = await saveCalendarReading(m.supabase, {
      ...base,
      monthKey: "annual",
      reviewedBy: "u",
    });
    expect(res.ok).toBe(true);
    expect(m.engEq).toEqual([
      ["id", "eng-1"],
      ["organization_id", "org-1"],
    ]);
    expect(m.inserts[0].period_kind).toBe("annual");
    expect(m.inserts[0].period_start).toBe("2025-04-01");
    expect(m.inserts[0].period_end).toBe("2026-03-31");
  });

  it("skips the engagement lookup when complianceYear is passed", async () => {
    const m = makeSupabase();
    const res = await saveCalendarReading(m.supabase, {
      ...base,
      monthKey: "annual",
      complianceYear: "FY2023-24",
      reviewedBy: "u",
    });
    expect(res.ok).toBe(true);
    expect(m.engQueried()).toBe(false);
    expect(m.inserts[0].period_start).toBe("2023-04-01");
    expect(m.inserts[0].period_end).toBe("2024-03-31");
  });

  it("returns ok=false naming the compliance year when it is not an FY label", async () => {
    const m = makeSupabase({ complianceYear: "someday" });
    const res = await saveCalendarReading(m.supabase, {
      ...base,
      monthKey: "annual",
      reviewedBy: "u",
    });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("someday");
    expect(m.inserts).toHaveLength(0);
  });

  it("returns ok=false when the engagement is missing (no 2023-24 fallback)", async () => {
    const m = makeSupabase({ complianceYear: null });
    const res = await saveCalendarReading(m.supabase, {
      ...base,
      monthKey: "annual",
      reviewedBy: "u",
    });
    expect(res.ok).toBe(false);
    expect(m.inserts).toHaveLength(0);
  });
});

describe("saveCalendarReading - invalid keys", () => {
  it.each(["2025-13", "2025-00", "2025-4", "April", "", "ANNUAL"])(
    "rejects monthKey %j",
    async (monthKey) => {
      const m = makeSupabase();
      const res = await saveCalendarReading(m.supabase, { ...base, monthKey, reviewedBy: "u" });
      expect(res.ok).toBe(false);
      expect(res.error).toContain("Invalid monthKey");
      expect(m.inserts).toHaveLength(0);
    },
  );

  it("truncates a long invalid monthKey to 40 characters in the error", async () => {
    const m = makeSupabase();
    const long = "x".repeat(100);
    const res = await saveCalendarReading(m.supabase, { ...base, monthKey: long, reviewedBy: "u" });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("x".repeat(40));
    expect(res.error).not.toContain("x".repeat(41));
  });

  it("rejects an unknown stream key", async () => {
    const m = makeSupabase();
    const res = await saveCalendarReading(m.supabase, {
      ...base,
      streamKey: "nope",
      reviewedBy: "u",
    });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("nope");
    expect(m.inserts).toHaveLength(0);
  });
});

describe("saveCalendarReading - page, bbox and extraction method", () => {
  const bbox = { x: 1, y: 2, width: 3, height: 4 };

  it("stores a null page and null bbox when no page is given (no page = 1 default)", async () => {
    const m = makeSupabase();
    await saveCalendarReading(m.supabase, {
      ...base,
      documentId: "doc-1",
      provenanceBbox: bbox,
    });
    expect(m.inserts[0].provenance_page).toBeNull();
    expect(m.inserts[0].provenance_bbox).toBeNull();
    expect(m.inserts[0].extraction_method).toBe("workbook_reader");
  });

  it("writes page and bbox and uses ai_extraction when a page exists", async () => {
    const m = makeSupabase();
    await saveCalendarReading(m.supabase, {
      ...base,
      documentId: "doc-1",
      provenancePage: 3,
      provenanceBbox: bbox,
      provenanceSourceText: "42 t",
    });
    expect(m.inserts[0].provenance_page).toBe(3);
    expect(m.inserts[0].provenance_bbox).toEqual(bbox);
    expect(m.inserts[0].extraction_method).toBe("ai_extraction");
    expect(m.inserts[0].provenance_source_text).toBe("42 t");
  });

  it("uses manual_entry and a default source text without a document", async () => {
    const m = makeSupabase();
    await saveCalendarReading(m.supabase, { ...base, reviewedBy: "u" });
    expect(m.inserts[0].extraction_method).toBe("manual_entry");
    expect(m.inserts[0].provenance_source_text).toMatch(/^Manual reading for /);
  });

  it("lets an explicit extractionMethod override the derived one", async () => {
    const m = makeSupabase();
    await saveCalendarReading(m.supabase, {
      ...base,
      documentId: "doc-1",
      extractionMethod: "manual_entry",
    });
    expect(m.inserts[0].extraction_method).toBe("manual_entry");
  });

  it("moves an Excel sheet/cell bbox into reading_meta.locator when there is no page", async () => {
    const m = makeSupabase();
    await saveCalendarReading(m.supabase, {
      ...base,
      documentId: "doc-1",
      provenanceBbox: { sheet: "Form1", cellRef: "D12" },
    });
    expect(m.inserts[0].provenance_bbox).toBeNull();
    expect(m.inserts[0].reading_meta).toEqual({ locator: { sheet: "Form1", cellRef: "D12" } });
  });

  it("keeps a caller-supplied locator and merges readingMeta", async () => {
    const m = makeSupabase();
    await saveCalendarReading(m.supabase, {
      ...base,
      documentId: "doc-1",
      provenanceBbox: { sheet: "Other", cellRef: "A1" },
      readingMeta: { verified: true, locator: { sheet: "S", cellRef: "B2" } },
    });
    expect(m.inserts[0].reading_meta).toEqual({
      verified: true,
      locator: { sheet: "S", cellRef: "B2" },
    });
  });

  it("gives different input hashes for different pages", async () => {
    const m = makeSupabase();
    await saveCalendarReading(m.supabase, { ...base, documentId: "d", provenancePage: 1 });
    await saveCalendarReading(m.supabase, { ...base, documentId: "d", provenancePage: 2 });
    await saveCalendarReading(m.supabase, { ...base, documentId: "d" });
    const hashes = m.inserts.map((r) => r.input_hash);
    expect(new Set(hashes).size).toBe(3);
  });
});

describe("saveCalendarReading - values", () => {
  it("prefers an explicit standardValue and valueAsStated", async () => {
    const m = makeSupabase();
    await saveCalendarReading(m.supabase, {
      ...base,
      reviewedBy: "u",
      standardValue: 7,
      valueAsStated: "7 tonnes",
      confidence: 0.9,
    });
    expect(m.inserts[0].standard_value).toBe(7);
    expect(m.inserts[0].value_as_stated).toBe("7 tonnes");
    expect(m.inserts[0].confidence).toBe(0.9);
    expect(m.inserts[0].standard_unit).toBe("t");
  });

  it("normalizes the value and stringifies it when no overrides are given", async () => {
    const m = makeSupabase();
    await saveCalendarReading(m.supabase, { ...base, reviewedBy: "u", valueNumeric: 2500, unit: "kg" });
    expect(m.inserts[0].standard_value).toBe(2.5);
    expect(m.inserts[0].value_as_stated).toBe("2500");
    expect(m.inserts[0].confidence).toBeNull();
  });
});

describe("saveCalendarReading - insert failure", () => {
  it("returns the database error message", async () => {
    const m = makeSupabase({ insertError: "boom" });
    const res = await saveCalendarReading(m.supabase, { ...base, reviewedBy: "u" });
    expect(res).toEqual({ ok: false, error: "boom" });
  });
});
