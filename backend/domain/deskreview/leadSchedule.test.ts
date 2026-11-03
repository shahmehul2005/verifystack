import { describe, expect, it } from "vitest";
import { CEMENT_DESK_REVIEW } from "./cement";
import { PROCEDURE_AS_A_WHOLE, clauseFor, clauseText } from "./clauses";
import type { DeskOutcome } from "./engine";
import { LEAD_ROWS, LEAD_STATUS_LABEL, buildLeadSchedule, unitForCheck } from "./leadSchedule";

const RULE_IDS = new Set(CEMENT_DESK_REVIEW.rules.map((r) => r.id));

function outcome(over: Partial<DeskOutcome> & Pick<DeskOutcome, "id" | "status">): DeskOutcome {
  return { section: "Production", label: "Check", detail: "Detail.", ...over };
}

describe("the schedule only points at checks that run", () => {
  it("has a row definition for real checks only", () => {
    const missing = LEAD_ROWS.filter((r) => !RULE_IDS.has(r.ruleId)).map((r) => r.ruleId);
    expect(missing).toEqual([]);
  });

  it("lists no check twice", () => {
    expect(new Set(LEAD_ROWS.map((r) => r.ruleId)).size).toBe(LEAD_ROWS.length);
  });

  it("only cites a clause to a check that runs", () => {
    for (const id of ["coal_stock_balance", "coverage_clinker", "gcv_samples", "materiality_aggregate", "renewable_claim", "sheet2_export"]) {
      expect(RULE_IDS.has(id), id).toBe(true);
      expect(clauseFor(id).specific, id).toBe(true);
    }
  });
});

describe("buildLeadSchedule", () => {
  it("compares what the check measured: evidenced against declared", () => {
    const { rows } = buildLeadSchedule({
      outcomes: [outcome({ id: "form1_direct", status: "fail", actual: 56794.75, expected: 55000, thresholdSource: "band" })],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ declared: 55000, evidenced: 56794.75, variance: 1794.75, status: "disagrees", unit: "tCO2e", band: "band" });
    expect(rows[0]!.variancePct).toBeCloseTo(3.263, 3);
  });

  it("takes an annual figure from the readings a coverage check used, not from its month counts", () => {
    const { rows } = buildLeadSchedule({
      outcomes: [
        outcome({
          id: "coverage_clinker",
          status: "fail",
          actual: 1,
          expected: 12,
          sources: [
            { key: "scada.months", label: "Months", value: 1 },
            { key: "pf.clinker_t", label: "Clinker", value: 150000, unit: "t" },
            { key: "scada.clinker_sum", label: "SCADA", value: 12500, unit: "t" },
          ],
        }),
      ],
    });
    expect(rows[0]).toMatchObject({ declared: 150000, evidenced: 12500, variance: -137500, status: "disagrees" });
  });

  it("never calls a line material and never says verified", () => {
    const { rows } = buildLeadSchedule({
      outcomes: [
        outcome({ id: "form1_direct", status: "fail", actual: 100, expected: 50 }),
        outcome({ id: "form1_indirect", status: "pass", actual: 10, expected: 10 }),
      ],
    });
    const text = [...rows.flatMap((r) => [r.status, r.label]), ...Object.values(LEAD_STATUS_LABEL)].join(" ");
    expect(text).not.toMatch(/material/i);
    expect(text).not.toMatch(/verified/i);
    expect(rows.map((r) => r.status)).toEqual(["disagrees", "agrees"]);
  });

  it("keeps a waiting row and a row that cannot be decided as they are", () => {
    const { rows, counts } = buildLeadSchedule({
      outcomes: [
        outcome({ id: "coal_stock_balance", status: "pending", missing: ["coal.opening_t"] }),
        outcome({ id: "coal_weighfeeder", status: "not_applicable", detail: "No figure." }),
      ],
    });
    expect(rows.map((r) => [r.ruleId, r.status])).toEqual([
      ["coal_stock_balance", "waiting"],
      ["coal_weighfeeder", "undecided"],
    ]);
    expect(rows[0]!.detail).toBe("Waiting for readings: coal.opening_t.");
    expect(rows[0]!.declared).toBeNull();
    expect(counts).toMatchObject({ waiting: 1, undecided: 1, agrees: 0, disagrees: 0 });
  });

  it("counts a disagreement or a wait that no one has decided", () => {
    const outcomes = [
      outcome({ id: "form1_direct", status: "fail", actual: 2, expected: 1 }),
      outcome({ id: "form1_indirect", status: "fail", actual: 2, expected: 1 }),
      outcome({ id: "coal_stock_balance", status: "pending", missing: ["x"] }),
    ];
    expect(buildLeadSchedule({ outcomes }).undecided).toBe(3);
    const decided = buildLeadSchedule({ outcomes, resolutions: { form1_direct: { state: "accepted_with_explanation", reason: "Because." } } });
    expect(decided.undecided).toBe(2);
    expect(decided.rows.find((r) => r.ruleId === "form1_direct")!.decision).toEqual({ state: "accepted_with_explanation", reason: "Because." });
  });

  it("states the aggregate position against 2% of the reported total, with what the total could not count", () => {
    const { aggregate } = buildLeadSchedule({
      outcomes: [],
      materiality: { reportedTotal: 50000, fraction: 0.02, threshold: 1000, quantified: 1200, limitations: ["Calcination CO2 is missing."] },
    });
    expect(aggregate).toEqual({ reportedTotal: 50000, fraction: 0.02, threshold: 1000, quantified: 1200, over: true, limitations: ["Calcination CO2 is missing."] });
    expect(buildLeadSchedule({ outcomes: [] }).aggregate).toBeNull();
  });

  it("leaves out a check the review did not produce, rather than inventing a row", () => {
    expect(buildLeadSchedule({ outcomes: [outcome({ id: "not_a_check", status: "fail" })] }).rows).toEqual([]);
  });

  it("knows the unit of a check", () => {
    expect(unitForCheck("form1_direct")).toBe("tCO2e");
    expect(unitForCheck("coverage_grid")).toBe("kWh");
    expect(unitForCheck("nope")).toBeNull();
  });
});

describe("clauseText", () => {
  it("says so when a check is cited to the procedure as a whole", () => {
    expect(clauseText(PROCEDURE_AS_A_WHOLE)).toMatch(/no single clause/);
    expect(clauseText(clauseFor("coverage_coal"))).not.toMatch(/no single clause/);
  });
});
