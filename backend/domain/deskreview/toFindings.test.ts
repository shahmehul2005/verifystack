import { describe, expect, it } from "vitest";
import type { DeskOutcome } from "./engine";
import { siteVisitQuestions } from "./questions";
import { PROCEDURE_AS_A_WHOLE, clauseText, requiredResponseFor } from "./clauses";
import { deskFindingDraft, deskFindings } from "./toFindings";

const MATERIALITY_CLAUSE =
  "BEE CCTS Detailed Procedure Section 6.12 & ISO 14064-3 — 2% statutory materiality threshold on aggregate discrepancies";
const PROCEDURE_CLAUSE = clauseText(PROCEDURE_AS_A_WHOLE);

function outcome(
  over: Partial<DeskOutcome> & Pick<DeskOutcome, "id" | "status">
): DeskOutcome {
  return {
    section: "Cross-check",
    label: "Check",
    detail: "Detail.",
    ...over,
  };
}

describe("deskFindings", () => {
  it("ignores pass, pending, and not applicable outcomes", () => {
    expect(
      deskFindings([
        outcome({ id: "coal_log_po", status: "pass", label: "Coal log vs PO" }),
        outcome({ id: "materiality_aggregate", status: "pass", label: "Aggregate materiality" }),
        outcome({ id: "source_profile", status: "pending", label: "Source profile" }),
        outcome({ id: "dpr_scada", status: "not_applicable", label: "DPR vs SCADA" }),
      ])
    ).toEqual([]);
  });

  it("maps a materiality_aggregate failure to a block finding", () => {
    expect(
      deskFindings([
        outcome({
          id: "materiality_aggregate",
          status: "fail",
          label: "Aggregate materiality",
          detail: "The difference exceeds 2% of total reported emissions.",
        }),
      ])
    ).toEqual([
      {
        ruleId: "DESK-materiality_aggregate",
        title: "Aggregate materiality",
        detail: "The difference exceeds 2% of total reported emissions.",
        severity: "block",
        clauseRef: MATERIALITY_CLAUSE,
        clauseVerified: true,
        requiredResponse: requiredResponseFor("materiality_aggregate"),
        evidenceRefs: [],
      },
    ]);
  });

  it("carries each reading's document and cell or page into the finding's evidence", () => {
    const [finding] = deskFindings([
      outcome({
        id: "form1_direct",
        status: "fail",
        sources: [
          { key: "pf.direct_co2", label: "Direct GHG", value: 56794.751793, unit: "tCO2e", slot: "proforma_workbook", filename: "15_proforma.xlsx", location: "3_GHG_CCTS!B20", documentId: "d1" },
          { key: "form1.direct_co2_t", label: "Form 1: direct energy CO2", value: 50000, unit: "tCO2e", slot: "form1", filename: "16_form1.pdf", location: "p. 2", documentId: "d2" },
        ],
      }),
    ]);
    expect(finding?.evidenceRefs).toEqual([
      "Direct GHG: 56794.751793 tCO2e — 15_proforma.xlsx · 3_GHG_CCTS!B20",
      "Form 1: direct energy CO2: 50000 tCO2e — 16_form1.pdf · p. 2",
    ]);
  });

  it("can draft a finding for a check that is waiting, for a scope limitation", () => {
    const draft = deskFindingDraft(outcome({ id: "coal_stock_balance", status: "pending", label: "Coal stock identity", missing: ["coal.opening_t", "coal.closing_t"] }));
    expect(draft.ruleId).toBe("DESK-coal_stock_balance");
    expect(draft.detail).toBe("Waiting for readings: coal.opening_t, coal.closing_t.");
    expect(draft.severity).toBe("warn");
  });

  it("maps a source_profile failure to a block finding with the desk clause", () => {
    const [finding] = deskFindings([
      outcome({
        id: "source_profile",
        status: "fail",
        label: "Source profile",
        detail: "The source profile is incomplete.",
      }),
    ]);
    expect(finding?.severity).toBe("block");
    expect(finding?.ruleId).toBe("DESK-source_profile");
    expect(finding?.clauseRef).toBe(PROCEDURE_CLAUSE);
    expect(finding?.clauseVerified).toBe(false);
  });

  it("maps every other failure to a warn finding", () => {
    expect(
      deskFindings([
        outcome({
          id: "coal_log_po",
          status: "fail",
          label: "Coal log vs PO",
          detail: "The consumption log does not match the purchase order.",
        }),
      ])
    ).toEqual([
      {
        ruleId: "DESK-coal_log_po",
        title: "Coal log vs PO",
        detail: "The consumption log does not match the purchase order.",
        severity: "warn",
        clauseRef: PROCEDURE_CLAUSE,
        clauseVerified: false,
        requiredResponse: requiredResponseFor("coal_log_po"),
        evidenceRefs: [],
      },
    ]);
  });

  it("cites the register's clause for a check that has one, and says it is verified", () => {
    const [finding] = deskFindings([outcome({ id: "coal_stock_balance", status: "fail", label: "Coal stock identity", detail: "Out of balance." })]);
    expect(finding?.clauseRef).toBe(
      "BEE CCTS Detailed Procedure Clause 4(5)(ii) & Section 5.20 — Fuel stock balance reconciliation and data control activities"
    );
    expect(finding?.clauseVerified).toBe(true);
    expect(finding?.requiredResponse).toMatch(/stock register/);
  });

  it("puts a size on the disagreement, in the check's own unit", () => {
    const [finding] = deskFindings([
      outcome({ id: "form1_direct", status: "fail", label: "Form 1 direct", detail: "Differs.", actual: 56794.75, expected: 55000 }),
    ]);
    expect(finding?.magnitude).toEqual({ value: 1794.75, unit: "tCO2e" });
  });

  it("sizes an annual figure from the sources the check read, not from months", () => {
    const [finding] = deskFindings([
      outcome({
        id: "coverage_clinker",
        status: "fail",
        label: "Clinker coverage",
        detail: "One month of twelve.",
        actual: 1,
        expected: 12,
        sources: [
          { key: "pf.clinker_t", label: "Clinker", value: 150000, unit: "t" },
          { key: "scada.clinker_sum", label: "SCADA clinker", value: 12500, unit: "t" },
        ],
      }),
    ]);
    expect(finding?.magnitude).toEqual({ value: 137500, unit: "t" });
  });

  it("sizes the aggregate check by the quantified sum, and leaves a check with no figures unsized", () => {
    const [agg] = deskFindings([outcome({ id: "materiality_aggregate", status: "fail", label: "Aggregate", actual: 1200, expected: 1000 })]);
    expect(agg?.magnitude).toEqual({ value: 1200, unit: "tCO2e" });
    const [none] = deskFindings([outcome({ id: "formula_integrity", status: "fail", label: "Formulas", detail: "Overwritten." })]);
    expect(none?.magnitude).toBeUndefined();
  });

  it("maps each fail again on a second call", () => {
    const outcomes = [
      outcome({
        id: "coal_log_po",
        status: "fail",
        label: "Coal log vs PO",
        detail: "The consumption log does not match the purchase order.",
      }),
    ];
    const first = deskFindings(outcomes);
    const second = deskFindings(outcomes);
    expect(second).toEqual(first);
    expect(first).toHaveLength(1);
    expect(deskFindings([...outcomes, ...outcomes])).toHaveLength(2);
  });
});

describe("siteVisitQuestions", () => {
  it("asks one question per failure and skips a pass", () => {
    expect(
      siteVisitQuestions([
        outcome({
          id: "coal_log_po",
          status: "fail",
          label: "Coal log vs PO",
          detail: "The consumption log does not match the purchase order.",
        }),
        outcome({ id: "cpp_report", status: "pass", label: "CPP report vs pro forma", detail: "Agrees." }),
        outcome({ id: "grid", status: "pending", label: "Grid electricity", detail: "Waiting for readings." }),
      ])
    ).toEqual([
      {
        id: "coal_log_po",
        question:
          "Ask the plant to explain: Coal log vs PO. The consumption log does not match the purchase order.",
      },
    ]);
  });

  it("returns the same questions on a second call", () => {
    const outcomes = [
      outcome({
        id: "coal_log_po",
        status: "fail",
        label: "Coal log vs PO",
        detail: "The consumption log does not match the purchase order.",
      }),
    ];
    expect(siteVisitQuestions(outcomes)).toEqual(siteVisitQuestions(outcomes));
  });
});
