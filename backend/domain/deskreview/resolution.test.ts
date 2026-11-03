import { describe, expect, it } from "vitest";
import { planDeskResolution, reconcileResolutions, ResolutionError } from "./resolution";

const REASON = "The plant sent a corrected sheet on site.";

const base = { reason: REASON, checkStatus: "fail" as const, inherentBlock: false };

describe("planDeskResolution", () => {
  it("needs a reason of at least ten characters for every decision", () => {
    for (const state of ["accepted_with_explanation", "unresolved_immaterial", "unresolved_material", "scope_limitation"] as const) {
      expect(() => planDeskResolution({ ...base, state, reason: "too short", finding: null })).toThrow(ResolutionError);
    }
  });

  it("closes a warn finding from a draft in two steps, with the explanation recorded", () => {
    const plan = planDeskResolution({ ...base, state: "accepted_with_explanation", finding: { severity: "warn", state: "suggested" } });
    expect(plan.path).toEqual(["accepted", "closed"]);
    expect(plan.recordExplanation).toBe(true);
    expect(plan.blocksSignOff).toBe(false);
  });

  it("takes a block finding the whole way: open, answered, verified, closed", () => {
    const plan = planDeskResolution({ ...base, inherentBlock: true, state: "accepted_with_explanation", finding: { severity: "block", state: "suggested" } });
    expect(plan.path).toEqual(["accepted", "open", "responded", "verified", "closed"]);
    expect(plan.severity).toBe("block");
  });

  it("continues from wherever a block finding already is", () => {
    const plan = planDeskResolution({ ...base, state: "accepted_with_explanation", finding: { severity: "block", state: "responded" } });
    expect(plan.path).toEqual(["verified", "closed"]);
  });

  it("only records the explanation on a finding that is already closed", () => {
    const plan = planDeskResolution({ ...base, state: "accepted_with_explanation", finding: { severity: "warn", state: "closed" } });
    expect(plan.path).toEqual([]);
    expect(plan.recordExplanation).toBe(true);
  });

  it("marks a check immaterial without holding sign-off, but not one that blocks by design", () => {
    const plan = planDeskResolution({ ...base, state: "unresolved_immaterial", finding: { severity: "warn", state: "suggested" } });
    expect(plan).toMatchObject({ severity: "warn", path: [], blocksSignOff: false });
    expect(() =>
      planDeskResolution({ ...base, inherentBlock: true, state: "unresolved_immaterial", finding: { severity: "block", state: "suggested" } })
    ).toThrow(/cannot be marked immaterial/);
  });

  it("raises a material decision or a scope limitation to block", () => {
    for (const state of ["unresolved_material", "scope_limitation"] as const) {
      const plan = planDeskResolution({ ...base, state, finding: { severity: "warn", state: "suggested" } });
      expect(plan).toMatchObject({ severity: "block", path: [], blocksSignOff: true });
    }
  });

  it("will not hold open a finding that is already closed or rejected", () => {
    for (const s of ["closed", "rejected"] as const) {
      expect(() => planDeskResolution({ ...base, state: "unresolved_material", finding: { severity: "block", state: s } })).toThrow(/already closed or rejected/);
    }
  });

  it("lets a check that is waiting for readings be a scope limitation and nothing else", () => {
    const waiting = { ...base, checkStatus: "pending" as const, finding: null };
    expect(planDeskResolution({ ...waiting, state: "scope_limitation" }).blocksSignOff).toBe(true);
    expect(() => planDeskResolution({ ...waiting, state: "accepted_with_explanation" })).toThrow(/waiting for readings/);
  });

  it("has nothing to decide on a check that agrees", () => {
    expect(() => planDeskResolution({ ...base, state: "unresolved_material", checkStatus: "pass", finding: null })).toThrow(/agrees/);
  });
});

describe("reconcileResolutions", () => {
  const results = [
    { id: "a", status: "pass" as const },
    { id: "b", status: "fail" as const },
    { id: "c", status: "pass" as const },
    { id: "d", status: "pending" as const },
    { id: "e", status: "pass" as const },
  ];

  it("marks a check resolved when it now agrees and it was decided or had a finding", () => {
    const out = reconcileResolutions(
      results,
      [
        { rule_id: "a", resolution_state: "unresolved_material" },
        { rule_id: "b", resolution_state: "unresolved_material" },
      ],
      new Set(["DESK-c"])
    );
    expect(out.markResolved.sort()).toEqual(["a", "c"]);
    expect(out.reopen).toEqual([]);
  });

  it("leaves a check that always agreed alone, and a decision on one that still disagrees", () => {
    const out = reconcileResolutions(results, [{ rule_id: "b", resolution_state: "accepted_with_explanation" }], new Set());
    expect(out.markResolved).toEqual([]);
  });

  it("sends a resolved check back to unresolved when it stops agreeing", () => {
    const out = reconcileResolutions(
      results,
      [
        { rule_id: "b", resolution_state: "resolved" },
        { rule_id: "d", resolution_state: "resolved" },
        { rule_id: "a", resolution_state: "resolved" },
      ],
      new Set()
    );
    expect(out.reopen.sort()).toEqual(["b", "d"]);
    expect(out.markResolved).toEqual([]);
  });
});
