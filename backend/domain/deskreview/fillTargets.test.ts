import { describe, expect, it } from "vitest";
import { fillTargets } from "./fillTargets";
import { deskReviewFor, runDeskReview } from "./index";

describe("fillTargets", () => {
  const manual = ["mpr.clinker_t", "mpr.opc_t", "dpr.clinker", "coal.opening_t"];

  it("points at the cards a check is missing, in the order it lists them", () => {
    expect(fillTargets(["mpr.opc_t", "mpr.clinker_t"], manual)).toEqual({ cards: ["mpr.opc_t", "mpr.clinker_t"], elsewhere: [] });
  });

  it("treats a daily series as the one daily card", () => {
    expect(fillTargets(["dpr.clinker@*", "scada.clinker@*"], manual)).toEqual({ cards: ["dpr.clinker"], elsewhere: ["scada.clinker@*"] });
    expect(fillTargets(["dpr.clinker@2023-11-01", "dpr.clinker@2023-11-02"], manual).cards).toEqual(["dpr.clinker"]);
  });

  it("keeps readings that are read from spreadsheets apart, and lists each once", () => {
    const t = fillTargets(["scada.clinker_sum", "mpr.clinker_t", "scada.clinker_sum"], manual);
    expect(t.cards).toEqual(["mpr.clinker_t"]);
    expect(t.elsewhere).toEqual(["scada.clinker_sum"]);
  });

  it("returns nothing for a check that is missing nothing", () => {
    expect(fillTargets([], manual)).toEqual({ cards: [], elsewhere: [] });
  });
});

describe("fillTargets against the cement desk review", () => {
  const def = deskReviewFor("CCTS-CEMENT-v1")!;
  const manualKeys = def.manual.map((m) => m.key);

  it("every missing reading of every waiting check is either a drawer card or read from a file", () => {
    const outcomes = runDeskReview(def, {});
    const waiting = outcomes.filter((o) => o.status === "pending");
    expect(waiting.length).toBeGreaterThan(0);
    for (const o of waiting) {
      const t = fillTargets(o.missing ?? [], manualKeys);
      expect(t.cards.length + t.elsewhere.length, o.id).toBeGreaterThan(0);
      for (const card of t.cards) expect(manualKeys, `${o.id} points at ${card}`).toContain(card);
    }
  });

  it("the clinker mass balance points at its monthly report and pro forma readings", () => {
    const o = runDeskReview(def, {}).find((r) => r.id === "clinker_mass_balance")!;
    const t = fillTargets(o.missing ?? [], manualKeys);
    expect(t.cards).toContain("mpr.clinker_opening_t");
    expect(t.cards).toContain("mpr.opc_t");
    expect(t.elsewhere).toContain("pf.cf_opc");
  });
});
