import { describe, expect, it } from "vitest";
import {
  AcceptanceDeclarationSchema,
  acceptanceContentHash,
  acceptanceRequired,
  assertAcceptanceAllowsSignoff,
  evaluateAcceptance,
  evaluateAcceptanceState,
  type AcceptanceDeclaration,
} from "./acceptance";

const CLEAN: AcceptanceDeclaration = {
  advisedOnMonitoringPlan: false,
  relationshipWithEntity: false,
  consultancyOwnershipLink: false,
  otherImpartialityThreat: false,
  contractInAgencyName: true,
  contractReference: "MSA-2026-014",
  contractReviewJustification: "Cement is in our accredited scope and the team is free for the audit window.",
  sectorInAccreditedScope: true,
};

describe("evaluateAcceptance", () => {
  it("clears a clean declaration", () => {
    const r = evaluateAcceptance(CLEAN);
    expect(r.outcome).toBe("cleared");
    expect(r.blockers).toEqual([]);
    expect(r.safeguarded).toBe(false);
  });

  it("makes advising on the monitoring plan a decline, whatever else is said (5.5.9)", () => {
    const r = evaluateAcceptance({ ...CLEAN, advisedOnMonitoringPlan: true, safeguards: "Separate team and a firewall between them." });
    expect(r.outcome).toBe("blocked");
    const b = r.blockers.find((x) => x.code === "advised_on_monitoring_plan");
    expect(b?.decline).toBe(true);
    expect(b?.clause).toMatch(/5\.5\.9/);
  });

  it("makes a consultancy ownership link a decline (5.5.10)", () => {
    const r = evaluateAcceptance({ ...CLEAN, consultancyOwnershipLink: true, safeguards: "Independent management of both firms." });
    expect(r.blockers.find((x) => x.code === "consultancy_ownership_link")?.decline).toBe(true);
  });

  it("lets a declared relationship through only with written safeguards", () => {
    const without = evaluateAcceptance({ ...CLEAN, relationshipWithEntity: true });
    expect(without.outcome).toBe("blocked");
    expect(without.blockers[0]?.code).toBe("safeguards_missing");
    expect(without.blockers[0]?.decline).toBe(false);

    const short = evaluateAcceptance({ ...CLEAN, relationshipWithEntity: true, safeguards: "ok" });
    expect(short.outcome).toBe("blocked");

    const withSafeguards = evaluateAcceptance({
      ...CLEAN,
      relationshipWithEntity: true,
      safeguards: "The entity's supplier contract is held by a different office and reviewed by the reviewer.",
    });
    expect(withSafeguards.outcome).toBe("cleared");
    expect(withSafeguards.safeguarded).toBe(true);
  });

  it("blocks a contract not in the agency's name (6.6.2) and a sector outside scope (3.5)", () => {
    const r = evaluateAcceptance({ ...CLEAN, contractInAgencyName: false, sectorInAccreditedScope: false });
    expect(r.blockers.map((b) => b.code).sort()).toEqual(["contract_not_in_agency_name", "sector_outside_scope"]);
    expect(r.blockers.every((b) => b.decline === false)).toBe(true);
  });
});

describe("declaration schema", () => {
  it("needs a contract reference and a real justification (6.6.3)", () => {
    expect(AcceptanceDeclarationSchema.safeParse({ ...CLEAN, contractReference: "" }).success).toBe(false);
    expect(AcceptanceDeclarationSchema.safeParse({ ...CLEAN, contractReviewJustification: "fine" }).success).toBe(false);
    expect(AcceptanceDeclarationSchema.safeParse(CLEAN).success).toBe(true);
  });

  it("hashes the same declaration to the same value", () => {
    expect(acceptanceContentHash(CLEAN)).toBe(acceptanceContentHash({ ...CLEAN }));
    expect(acceptanceContentHash(CLEAN)).not.toBe(acceptanceContentHash({ ...CLEAN, contractReference: "other" }));
  });
});

describe("acceptance state and sign-off gate", () => {
  it("applies to CCTS only", () => {
    expect(acceptanceRequired("CCTS")).toBe(true);
    expect(acceptanceRequired("ADEETIE")).toBe(false);
    expect(evaluateAcceptanceState({ required: false, latest: null }).blocks).toBe(false);
  });

  it("blocks sign-off when nothing is recorded or the latest is blocked", () => {
    const missing = evaluateAcceptanceState({ required: true, latest: null });
    expect(missing.status).toBe("missing");
    expect(() => assertAcceptanceAllowsSignoff(missing)).toThrow();
    const blocked = evaluateAcceptanceState({ required: true, latest: { outcome: "blocked" } });
    expect(blocked.status).toBe("blocked");
    expect(() => assertAcceptanceAllowsSignoff(blocked)).toThrow();
  });

  it("lets sign-off continue once cleared", () => {
    const ok = evaluateAcceptanceState({ required: true, latest: { outcome: "cleared" } });
    expect(ok.status).toBe("cleared");
    expect(() => assertAcceptanceAllowsSignoff(ok)).not.toThrow();
  });
});