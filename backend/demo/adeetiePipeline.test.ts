import { describe, expect, it } from "vitest";
import { runAdeetieDemoPipeline } from "./adeetiePipeline";

describe("ADEETIE demo pipeline", () => {
  const p = runAdeetieDemoPipeline();

  it("runs the whole Foundry path from facts to a savings assessment", () => {
    expect(p.baseline.phase).toBe("baseline");
    expect(p.post.phase).toBe("post_implementation");
    expect(p.baseline.sec).toBeGreaterThan(0);
    expect(p.post.sec).toBeGreaterThan(0);
    expect(p.baseline.secUnitLabel).toBe("GJ/t");
  });

  it("is reproducible", () => {
    const again = runAdeetieDemoPipeline();
    expect(again.baselineInputHash).toBe(p.baselineInputHash);
    expect(again.postInputHash).toBe(p.postInputHash);
    expect(again.savings.savingsPct).toBe(p.savings.savingsPct);
  });

  it("keeps kVA demand out of the energy total", () => {
    expect(p.baseline.demand?.contractedDemandKVA).toBe(1_250);
    expect(p.baseline.demand?.maximumDemandKVA).toBe(1_085);
    const streamTotal = p.baseline.streams.reduce((a, s) => a + s.energyMJ.value, 0);
    expect(p.baseline.totalEnergyMJ.value).toBeCloseTo(streamTotal, 0);
  });

  it("clears the 10% gate on a like-for-like comparison", () => {
    expect(p.savings.savingsPct).toBeGreaterThanOrEqual(p.minSavingsPct);
    expect(p.savings.meetsThreshold).toBe(true);
    expect(p.savings.comparabilityWarnings).toEqual([]);
  });

  it("raises no blocking finding for the clean synthetic enterprise", () => {
    expect(p.rules.blocks).toBe(0);
  });

  it("still says out loud that the factors and cluster list are unverified", () => {
    expect(p.baseline.warnings.some((w) => w.includes("UNVERIFIED"))).toBe(true);
    expect(p.clusterIsNotified).toBe(true);
    const clusterFinding = p.rules.findings.find((f) => f.ruleId === "AD-ELG002");
    expect(clusterFinding?.severity).toBe("info");
    expect(clusterFinding?.detail).toMatch(/unverified/);
    expect(p.disclaimer).toMatch(/unverified placeholders/);
    expect(p.disclaimer).toMatch(/not the official BEE DPR or M&V template/i);
  });

  it("computes the subvention rather than asserting it", () => {
    expect(p.subvention.category).toBe("Small");
    expect(p.subvention.headlineSubventionPct).toBe(5);
    expect(p.subvention.appliedSubventionPct).toBe(5);
    expect(p.subvention.netBorrowingRatePct).toBe(5);
    expect(p.subvention.annualReliefINR).toBe(10_00_000);
  });
});
