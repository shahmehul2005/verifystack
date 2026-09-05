import { describe, expect, it } from "vitest";
import {
  engagementLinksForRole,
  hasCapability,
  homePathFor,
  navForRole,
} from "./capabilities";

describe("DFD role capabilities", () => {
  it("does not let firm admin run verification work", () => {
    expect(hasCapability("firm_admin", "documents.upload")).toBe(false);
    expect(hasCapability("firm_admin", "runs.execute")).toBe(false);
    expect(hasCapability("firm_admin", "signoff.lead")).toBe(false);
    expect(hasCapability("firm_admin", "signoff.reviewer")).toBe(false);
    expect(hasCapability("firm_admin", "review.decide")).toBe(false);
    expect(hasCapability("firm_admin", "team.manage")).toBe(true);
    expect(hasCapability("firm_admin", "nav.audit")).toBe(true);
  });

  it("keeps the ADEETIE lifecycle out of firm administration", () => {
    // Measures, loan figures and phase blockers are P5–P7 material.
    expect(hasCapability("firm_admin", "adeetie.view")).toBe(false);
    expect(hasCapability("firm_admin", "adeetie.operate")).toBe(false);
    expect(hasCapability("verifier", "adeetie.view")).toBe(true);
    expect(hasCapability("verifier", "adeetie.operate")).toBe(false);
    expect(hasCapability("independent_reviewer", "adeetie.view")).toBe(true);
    expect(hasCapability("independent_reviewer", "adeetie.operate")).toBe(false);
    expect(hasCapability("lead_verifier", "adeetie.operate")).toBe(true);
  });

  it("shows no nav to a user with no membership yet", () => {
    // A signed-in user without an organisation has nothing org-scoped to open.
    expect(navForRole(null)).toEqual([]);
    expect(navForRole(undefined)).toEqual([]);
  });

  it("gives the lead P1, P5, D8 and P7 maker", () => {
    expect(hasCapability("lead_verifier", "engagements.create")).toBe(true);
    expect(hasCapability("lead_verifier", "runs.execute")).toBe(true);
    expect(hasCapability("lead_verifier", "factors.verify")).toBe(true);
    expect(hasCapability("lead_verifier", "nav.factors")).toBe(false);
    expect(hasCapability("lead_verifier", "signoff.lead")).toBe(true);
    expect(hasCapability("lead_verifier", "signoff.reviewer")).toBe(false);
    expect(hasCapability("lead_verifier", "team.manage")).toBe(false);
  });

  it("gives the verifier P2–P4 and P6, not sign-off or calc", () => {
    expect(hasCapability("verifier", "documents.upload")).toBe(true);
    expect(hasCapability("verifier", "documents.extract")).toBe(true);
    expect(hasCapability("verifier", "review.decide")).toBe(true);
    expect(hasCapability("verifier", "findings.decide")).toBe(true);
    expect(hasCapability("verifier", "runs.execute")).toBe(false);
    expect(hasCapability("verifier", "signoff.lead")).toBe(false);
    expect(hasCapability("verifier", "nav.team")).toBe(false);
  });

  it("gives the independent reviewer P4/P6/P7 checker only", () => {
    expect(hasCapability("independent_reviewer", "review.decide")).toBe(true);
    expect(hasCapability("independent_reviewer", "signoff.reviewer")).toBe(true);
    expect(hasCapability("independent_reviewer", "documents.upload")).toBe(false);
    expect(hasCapability("independent_reviewer", "runs.execute")).toBe(false);
    expect(hasCapability("independent_reviewer", "engagements.create")).toBe(false);
  });

  it("keeps nav and engagement tiles in sync with the same map", () => {
    expect(navForRole("firm_admin").map((i) => i.href)).toEqual([
      "/engagements",
      "/packs",
      "/audit",
      "/team",
    ]);
    expect(engagementLinksForRole("verifier").map((i) => i.slug)).toEqual([
      "documents",
      "workbench",
      "facts",
      "runs",
      "findings",
      "ecm",
    ]);
    expect(engagementLinksForRole("independent_reviewer").some((i) => i.slug === "signoff")).toBe(
      true
    );
    expect(engagementLinksForRole("firm_admin").some((i) => i.slug === "ecm")).toBe(false);
    expect(engagementLinksForRole("verifier").some((i) => i.slug === "ecm")).toBe(true);
    expect(homePathFor("firm_admin")).toBe("/team");
    expect(homePathFor("verifier")).toBe("/engagements");
  });
});
