import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@verifystack/backend/lib/supabase/types";
import {
  canonicalKeyToBindingPath,
  loadCommittedFactsForEngagement,
} from "./committedEvidence";

describe("committedEvidence - Canonical Key Mapping & Deduplication", () => {
  it("maps canonical keys to methodology pack binding paths", () => {
    expect(canonicalKeyToBindingPath("equivalent_product")).toBe("production");
    expect(canonicalKeyToBindingPath("clinker_production")).toBe("clinker.production");
    expect(canonicalKeyToBindingPath("coal_quantity")).toBe("quantity");
    expect(canonicalKeyToBindingPath("coal_consumed")).toBe("quantity");
    expect(canonicalKeyToBindingPath("coal_gcv")).toBe("calorificValue");
    expect(canonicalKeyToBindingPath("grid_electricity")).toBe("activeEnergy");
    expect(canonicalKeyToBindingPath("calcination_co2")).toBe("process.calcinationEmissions");
  });

  it("handles composite stream keys with source_type suffix", () => {
    expect(canonicalKeyToBindingPath("coal_quantity#sourcing")).toBe("quantity");
    expect(canonicalKeyToBindingPath("grid_electricity#corroboration")).toBe("activeEnergy");
    expect(canonicalKeyToBindingPath("equivalent_product#proforma")).toBe("production");
  });

  it("deduplicates multiple monthly fallback facts into single annual facts", async () => {
    // Mock Supabase client returning 12 monthly facts for production
    const monthlyValues = [
      62251.3, 61530.0, 62376.8, 64272.0, 65192.9, 66808.1,
      67805.6, 64437.5, 66907.0, 66903.2, 67406.7, 65358.9,
    ];

    const mockFacts = monthlyValues.map((v, i) => ({
      id: `fact-prod-${i}`,
      engagement_id: "eng-1",
      organization_id: "org-1",
      field_path: "production",
      value_json: v,
      unit: "t",
      period_start: `2023-${String(i + 1).padStart(2, "0")}-01`,
      period_end: `2023-${String(i + 1).padStart(2, "0")}-28`,
      period_status: "known",
      canonical_key: "equivalent_product",
      provenance_type: "document_page",
      source_text: `Monthly production ${v}`,
      page: 1,
      bbox: null,
      created_at: new Date().toISOString(),
    }));

    const mockSupabase = {
      from: vi.fn((table: string) => {
        if (table === "engagements") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { id: "eng-1", compliance_year: "FY2023-24", pack_id: "CCTS-CEMENT-v1" },
            }),
          };
        }
        if (table === "documents") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            data: [],
          };
        }
        if (table === "canonical_evidence_values") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            not: vi.fn().mockReturnThis(),
            in: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({ data: [] }),
          };
        }
        if (table === "facts") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            then: (resolve: (val: { data: unknown }) => unknown) =>
              resolve({ data: mockFacts }),
          };
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({ data: [] }),
        };
      }),
    };

    const committed = await loadCommittedFactsForEngagement(
      mockSupabase as unknown as SupabaseClient<Database>,
      "eng-1",
      "org-1"
    );

    // Must return exactly ONE fact for production
    const prodFacts = committed.filter((f) => f.field_path === "production");
    expect(prodFacts).toHaveLength(1);

    // The rolled up value must be the sum of all 12 monthly values
    const expectedSum = monthlyValues.reduce((a, b) => a + b, 0);
    expect(Number(prodFacts[0].value_json)).toBeCloseTo(expectedSum, 1);
  });
});
