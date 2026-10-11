import { describe, expect, it } from "vitest";
import {
  assessPlan,
  deriveAutoFactors,
  maxRating,
  PlanContentSchema,
  planApprovalBlockers,
  planContentHash,
  POLICY_SAMPLE_RATE,
  RISK_FACTORS,
  type PlanContent,
} from "./plan";

function plan(over: Partial<Record<string, "low" | "medium" | "high">> = {}, extra: Partial<PlanContent> = {}): PlanContent {
  return {
    factors: RISK_FACTORS.map((f) => ({ key: f.key, rating: over[f.key] ?? "low", rationale: `Assessed ${f.label}` })),
    visits: [],
    ...extra,
  };
}

describe("assessPlan", () => {
  it("is low risk with the lowest sampling rate when everything is low", () => {
    const a = assessPlan(plan());
    expect(a).toMatchObject({ overall: "low", sampleRate: POLICY_SAMPLE_RATE.low, siteVisitRecommended: false, siteVisitGap: false });
    expect(a.drivers).toEqual([]);
  });

  it("takes the highest rating, so one high factor cannot be averaged away", () => {
    const a = assessPlan(plan({ data_source: "high" }));
    expect(a.overall).toBe("high");
    expect(a.drivers).toEqual(["data_source"]);
    expect(a.sampleRate).toBe(POLICY_SAMPLE_RATE.high);
  });

  it("recommends a site visit for high data-source or boundary risk and for medium overall", () => {
    expect(assessPlan(plan({ boundary_clarity: "high" })).siteVisitReasons.join(" ")).toMatch(/Boundary clarity is rated high/);
    const med = assessPlan(plan({ entity_history: "medium" }));
    expect(med.siteVisitRecommended).toBe(true);
    expect(med.siteVisitReasons).toContain("Overall risk is medium.");
  });

  it("flags a gap until a visit is planned or the waiver is reasoned", () => {
    expect(assessPlan(plan({ data_source: "high" })).siteVisitGap).toBe(true);
    const planned = plan({ data_source: "high" }, { visits: [{ id: "v1", plannedFor: "2026-11-01", location: "Unit 1", scope: "Check kiln meters" }] });
    expect(assessPlan(planned).siteVisitGap).toBe(false);
    expect(assessPlan(plan({ data_source: "high" }, { siteVisitWaiverReason: "Remote metering verified by the grid operator" })).siteVisitGap).toBe(false);
  });

  it("lets automatic factors raise the rating but never lower it", () => {
    const auto = deriveAutoFactors({ comparison: { compared: 10, disagree: 3 }, unverifiedFactors: 0 });
    expect(auto.find((f) => f.key === "declared_vs_evidence")!.rating).toBe("high");
    expect(assessPlan(plan(), auto).overall).toBe("high");
    expect(assessPlan(plan({ entity_history: "high" }), deriveAutoFactors({ unverifiedFactors: 0 })).overall).toBe("high");
  });

  it("honours a reasoned sampling override", () => {
    const a = assessPlan(plan({}, { sampleRateOverride: { rate: 0.5, reason: "Client requested a deeper sample" } }));
    expect(a).toMatchObject({ sampleRate: 0.5, sampleRateSource: "override" });
  });
});

describe("deriveAutoFactors", () => {
  it("rates by share of disagreement and count of unverified factors", () => {
    expect(deriveAutoFactors({ comparison: { compared: 10, disagree: 0 } })[0]!.rating).toBe("low");
    expect(deriveAutoFactors({ comparison: { compared: 10, disagree: 1 } })[0]!.rating).toBe("medium");
    expect(deriveAutoFactors({ unverifiedFactors: 3 })[0]!.rating).toBe("high");
    expect(deriveAutoFactors({ comparison: { compared: 0, disagree: 0 } })).toEqual([]);
    expect(deriveAutoFactors({})).toEqual([]);
  });
  it("maxRating of nothing is low", () => {
    expect(maxRating([])).toBe("low");
  });
});

describe("approval", () => {
  it("requires every factor rated and the visit gap closed", () => {
    const partial: PlanContent = { factors: [{ key: "entity_history", rating: "low", rationale: "Repeat client, clean" }], visits: [] };
    expect(planApprovalBlockers(partial)[0]).toMatch(/Rate every risk factor/);
    expect(planApprovalBlockers(plan({ data_source: "high" })).join(" ")).toMatch(/site visit is recommended/);
    expect(planApprovalBlockers(plan())).toEqual([]);
  });
});

describe("schema and hash", () => {
  it("rejects a rating with no real rationale and a nonsense sample rate", () => {
    expect(PlanContentSchema.safeParse({ factors: [{ key: "x", rating: "low", rationale: "ok" }], visits: [] }).success).toBe(false);
    expect(PlanContentSchema.safeParse({ ...plan(), sampleRateOverride: { rate: 2, reason: "far too high rate" } }).success).toBe(false);
    expect(PlanContentSchema.safeParse(plan()).success).toBe(true);
  });
  it("hashes content independent of key order", () => {
    const a = plan();
    expect(planContentHash(a)).toBe(planContentHash(JSON.parse(JSON.stringify({ visits: a.visits, factors: a.factors }))));
  });
});
