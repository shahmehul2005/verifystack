/**
 * The clause each desk-review check answers to, and what a plant is asked to do
 * when a check disagrees. One place, so a finding, the lead schedule and the
 * binder cite the same words.
 *
 * The clause strings are the ones in docs/domain/regulatory-register.md, section
 * 4, which the project owner confirmed against the government source on
 * 30 October 2026. A check with no single clause is cited to the procedure as a
 * whole and flagged `specific: false`; nothing here invents a clause number.
 */

export interface ClauseRef {
  /** The reference as it is cited on a finding or in the binder. */
  ref: string;
  /** The register lists this reference as verified against the government source. */
  verified: boolean;
  /** False when the check has no clause of its own and is cited to the procedure as a whole. */
  specific: boolean;
}

const verified = (ref: string): ClauseRef => ({ ref, verified: true, specific: true });

const STOCK = verified(
  "BEE CCTS Detailed Procedure Clause 4(5)(ii) & Section 5.20 — Fuel stock balance reconciliation and data control activities"
);
const COMPLETENESS = verified(
  "BEE CCTS Detailed Procedure Clause 4(5)(i)(b) & Section 5.6 — Completeness of monthly monitored data series"
);
const SAMPLING = verified(
  "BEE CCTS Detailed Procedure Clause 4(8)(iii) & Section 5.13 — Mandatory sampling frequency (coal monthly or per 20,000 t; raw material monthly or per 50,000 t)"
);
const NCV = verified(
  "BEE CCTS Detailed Procedure Clause 4(6) & Annexure III — Mandatory NCV basis (5% solid/liquid default if lab unavailable)"
);
const MATERIALITY = verified(
  "BEE CCTS Detailed Procedure Section 6.12 & ISO 14064-3 — 2% statutory materiality threshold on aggregate discrepancies"
);
const RENEWABLE = verified(
  "BEE CCTS Detailed Procedure Clause 4(12)(iii) — Exclusion of Renewable Energy Certificates (RECs) from renewable energy claims"
);
const EXPORT = verified("BEE CCTS Detailed Procedure Clause 4(11) / Section 5.16 — Net power export emissions deduction");
/**
 * Register rule DEV001 lists this clause and the 71.7 kcal/kg band as confirmed (the project owner's
 * statement, section 4 of the register). The wording was also read from the primary-source PDF held
 * in the repository (page 14). What the register does not confirm, and the rule therefore does not
 * decide, is the sign of the "difference" that is added back and whether it applies per quarter.
 */
const NABL: ClauseRef = {
  ref: "BEE CCTS Detailed Procedure Clause 4(10)(ii)-(iii), p. 14 — External laboratory analysis: internal vs NABL coal result must deviate by less than 71.7 kcal/kg (ISO 1928:1995(E)); an excess is added to the internal lab's analysed parameter for the quarter",
  verified: true,
  specific: true,
};

/** Cited when a check has no clause of its own: a consistency check between two documents the entity supplied. */
export const PROCEDURE_AS_A_WHOLE: ClauseRef = {
  ref: "BEE CCTS Detailed Procedure (v1.0, July 2024) — consistency of the reported figures with the supporting records",
  verified: false,
  specific: false,
};

const BY_CHECK: Record<string, ClauseRef> = {
  coal_stock_balance: STOCK,
  coal_weighfeeder: STOCK,
  coverage_clinker: COMPLETENESS,
  coverage_cpp: COMPLETENESS,
  coverage_grid: COMPLETENESS,
  coverage_coal: COMPLETENESS,
  production_days: COMPLETENESS,
  gcv_samples: SAMPLING,
  gcv_ncv_used: NCV,
  gcv_nabl_corroboration: NABL,
  materiality_aggregate: MATERIALITY,
  renewable_claim: RENEWABLE,
  sheet2_export: EXPORT,
};

export function clauseFor(checkId: string): ClauseRef {
  return BY_CHECK[checkId] ?? PROCEDURE_AS_A_WHOLE;
}

/** How a clause reads on a finding. A reference that is not pinned says so, so nobody mistakes it for a citation. */
export function clauseText(c: ClauseRef): string {
  return c.specific ? c.ref : `${c.ref} (no single clause; cited to the procedure as a whole)`;
}

const COVERAGE_RESPONSE =
  "Provide the records for the months not evidenced, or show how the annual figure is supported. Annualising one month is not accepted evidence.";
const STOCK_RESPONSE = "Provide the stock register and the weighbridge or weigh-feeder records for the period, and reconcile them to the reported consumption.";

const RESPONSE_BY_CHECK: Record<string, string> = {
  coverage_clinker: COVERAGE_RESPONSE,
  coverage_cpp: COVERAGE_RESPONSE,
  coverage_grid: COVERAGE_RESPONSE,
  coverage_coal: COVERAGE_RESPONSE,
  production_days: "Explain each zero-output day that is not marked as down, and each down day that shows output, with the kiln log for those days.",
  coal_stock_balance: STOCK_RESPONSE,
  coal_weighfeeder: STOCK_RESPONSE,
  gcv_samples: "Provide the lab sampling records for the period, or explain the shortfall against the sampling frequency.",
  gcv_ncv_used: "Show that the net calorific value is used where the procedure requires it, or correct the workbook.",
  gcv_nabl_corroboration:
    "Provide the internal lab result for the quarter the NABL certificate covers, and show how the difference over 71.7 kcal/kg was added to the internal result, or explain the deviation.",
  petcoke_cell: "State the quantity and the emission factor used for this fuel, with the supporting records, or confirm that it does not occur.",
  source_profile: "State the quantity and the factor for each unquantified source, with supporting records, or confirm that it does not occur.",
  materiality_aggregate: "Resolve or explain the quantified misstatements, and supply the sources the total could not count.",
  renewable_claim: "Provide the exclusion in the workbook for the renewable claim, or withdraw the claim.",
  formula_integrity: "Restore the formula cells that were overwritten, or explain each change.",
};

const DEFAULT_RESPONSE = "Explain the difference between the two figures and provide the records that reconcile them.";

export function requiredResponseFor(checkId: string): string {
  return RESPONSE_BY_CHECK[checkId] ?? DEFAULT_RESPONSE;
}
