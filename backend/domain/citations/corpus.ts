/**
 * SYNTHETIC regulatory corpus for demo and tests.
 *
 * PRODUCTION INGESTION MUST USE REAL BEE DOCUMENTS. The Bureau of Energy
 * Efficiency PDFs are not in this repository. Every title, URL, and clause
 * below is labelled synthetic so a reviewer cannot mistake it for gazetted
 * text. Do not cite this fixture in a live verification.
 *
 * Coverage is limited to the current demo packs: ADEETIE Foundry and
 * CCTS Cement.
 */

import type { PackSchemeName } from "./types";

export interface CorpusDocument {
  /** Always true on this fixture. */
  synthetic: true;
  title: string;
  scheme: PackSchemeName;
  sectorOrCluster: string;
  sourceUrl: string;
  effectiveDate: string;
  body: string;
}

export const SYNTHETIC_CORPUS_CAVEAT =
  "SYNTHETIC sample corpus. Production ingestion must use real BEE documents. These clauses are not gazetted and must not be cited in a live verification.";

const ADEETIE_FOUNDRY_BODY = `
=== Clause ADEETIE-SYN-3.1 | page 4 ===
Udyam Registration. An MSME applying under ADEETIE shall hold a valid Udyam Registration Number as printed on the Udyam Registration Certificate. The scheme is open to Udyam-registered MSMEs. An application file that records no Udyam Registration Number has not evidenced MSME status under this clause. The registration number is evidence of category (Micro, Small or Medium) as printed; this clause does not itself verify the number against the Udyam portal.

=== Clause ADEETIE-SYN-3.2 | page 5 ===
Notified cluster. The enterprise must operate in a notified cluster for the sector, or within 200 km of a notified cluster boundary. A unit that is not in a notified cluster list, and that has claimed no distance to a notified cluster within 200 km, does not meet this geographic gate. Distance to a cluster boundary is a claim to be evidenced; this clause does not compute it.

=== Clause ADEETIE-SYN-3.3 | page 6 ===
Eligible loan size. The eligible loan amount lies between Rs 10 lakh and Rs 15 crore. A loan amount below the minimum or above the maximum of this range is outside the eligible range. Loan amount for this purpose is the sanctioned principal in Indian rupees.

=== Clause ADEETIE-SYN-3.4 | page 6 ===
Debt funding share. Up to 75% debt funding of project cost qualifies. Where the loan against project cost is above the 75% that qualifies, the excess does not qualify as scheme debt. Project cost must be stated; a project cost of zero means the debt share cannot be computed.

=== Clause ADEETIE-SYN-3.5 | page 7 ===
Interest subvention. Interest subvention is 5% for a Micro or Small enterprise and 3% for a Medium enterprise, subject to a minimum net borrowing rate of 2%. A claimed interest subvention above the rate for the enterprise category does not match the category entitlement. Subvention is capped so the net borrowing rate never falls below 2%.

=== Clause ADEETIE-SYN-4.1 | page 9 ===
Measured energy savings. The scheme requires a minimum 10% energy savings, achieved and sustained, before an annual interest subvention release. Baseline specific energy consumption against post-implementation specific energy consumption is the measured reduction. A reduction below the scheme minimum of 10% does not meet this gate. Comparability of the two SEC figures is a precondition; a movement produced by a dropped stream or a changed output unit is not an energy saving under this clause.

=== Clause ADEETIE-SYN-5.1 | page 11 ===
Energy balance closure. Billed energy and metered energy must reconcile within the stated tolerance. Where billed energy does not reconcile with metered energy, either a load is unmetered or the billed figure covers loads outside the audit boundary. Months of billed energy with no metered figure mean the energy balance cannot be closed and the baseline rests on the utility invoice alone.

=== Clause ADEETIE-SYN-5.2 | page 12 ===
Measuring instrument calibration. A reading is usable only if the meter's calibration was valid over the period its readings are relied on. A meter with no calibration record, or whose calibration expired before the end of the relied-on period, does not support those readings. Readings before the calibration date are outside the instrument's demonstrated accuracy.

=== Clause ADEETIE-SYN-6.1 | page 13 ===
Baseline year completeness. A baseline year must be complete. A baseline missing energy data for one or more months of the expected year understates annual energy. If output for a missing month is still counted, specific energy consumption is understated and any savings measured against that baseline are overstated.
`.trim();

const CCTS_CEMENT_BODY = `
=== Clause CCTS-SYN-2.1 | page 8 ===
Fuel stock movement and data flow. Opening stock plus purchases minus closing stock shall reconcile with reported consumption for each fuel stream. A material difference between implied consumption and the quantity reported is a data-flow discrepancy. The procedure requires control activities over this data flow; an unresolved quantity discrepancy on a stream is recorded against this clause.

=== Clause CCTS-SYN-4.1 | page 14 ===
Net calorific value. Emissions shall be estimated using actual net calorific value (NCV). A laboratory certificate that reports a GROSS calorific value (GCV) where net calorific value is required does not meet this clause. Where only GCV is available, any default conversion to NCV introduces avoidable uncertainty and shall be identified rather than treated as a tested NCV.

=== Clause CCTS-SYN-4.2 | page 15 ===
NABL accredited lab testing. A laboratory result used for fuel quality shall come from a NABL accredited lab whose accreditation was valid on the date of test. A certificate that carries no NABL accreditation number, or a sample tested after the NABL accreditation expired, is not a valid lab result under this clause.

=== Clause CCTS-SYN-6.1 | page 18 ===
Completeness of monitored data. Monthly series used for annual totals shall be complete for the compliance year. A gap in a monthly data series — missing data for one or more months — means annual totals derived from that series will understate actual activity. Completeness of monitored data is a control, not an optional convenience.

=== Clause CCTS-SYN-7.1 | page 20 ===
Sampling. Coal shall be sampled monthly or per 20,000 t throughput, whichever requires more samples; raw material monthly or per 50,000 t. Sampling frequency below the mandated minimum undermines the fuel quality basis. The number of samples recorded is compared against throughput in tonnes and the monthly minimum.

=== Clause CCTS-SYN-8.1 | page 22 ===
Grid emission factor vintage. The CEA CO2 baseline database version applied shall match the compliance year. A grid emission factor vintage that does not match the compliance year is a recurring finding. Confirm which CEA database version applies to this cycle before the factor is used in the inventory.
`.trim();

export const SYNTHETIC_CORPUS: CorpusDocument[] = [
  {
    synthetic: true,
    title:
      "[SYNTHETIC] ADEETIE Operational Guidelines — Foundry (demo fixture, not gazetted BEE text)",
    scheme: "ADEETIE",
    sectorOrCluster: "Foundry",
    sourceUrl: "https://example.invalid/verifystack/synthetic/adeetie-foundry-guidelines",
    effectiveDate: "2025-04-01",
    body: ADEETIE_FOUNDRY_BODY,
  },
  {
    synthetic: true,
    title:
      "[SYNTHETIC] CCTS Detailed Procedure — Cement (demo fixture, not gazetted BEE text)",
    scheme: "CCTS",
    sectorOrCluster: "Cement",
    sourceUrl: "https://example.invalid/verifystack/synthetic/ccts-cement-procedure",
    effectiveDate: "2025-04-01",
    body: CCTS_CEMENT_BODY,
  },
];

/** Rule id → fixture clause that should rank in the top-k for that sector. */
export const RETRIEVAL_GOLDEN: Array<{
  scheme: PackSchemeName;
  sectorOrCluster: string;
  ruleId: string;
  expectedClauseRef: string;
}> = [
  { scheme: "ADEETIE", sectorOrCluster: "Foundry", ruleId: "AD-ELG001", expectedClauseRef: "ADEETIE-SYN-3.1" },
  { scheme: "ADEETIE", sectorOrCluster: "Foundry", ruleId: "AD-ELG002", expectedClauseRef: "ADEETIE-SYN-3.2" },
  { scheme: "ADEETIE", sectorOrCluster: "Foundry", ruleId: "AD-ELG003", expectedClauseRef: "ADEETIE-SYN-3.3" },
  { scheme: "ADEETIE", sectorOrCluster: "Foundry", ruleId: "AD-ELG004", expectedClauseRef: "ADEETIE-SYN-3.4" },
  { scheme: "ADEETIE", sectorOrCluster: "Foundry", ruleId: "AD-ELG005", expectedClauseRef: "ADEETIE-SYN-3.5" },
  { scheme: "ADEETIE", sectorOrCluster: "Foundry", ruleId: "AD-SAV001", expectedClauseRef: "ADEETIE-SYN-4.1" },
  { scheme: "ADEETIE", sectorOrCluster: "Foundry", ruleId: "AD-EB001", expectedClauseRef: "ADEETIE-SYN-5.1" },
  { scheme: "ADEETIE", sectorOrCluster: "Foundry", ruleId: "AD-CAL001", expectedClauseRef: "ADEETIE-SYN-5.2" },
  { scheme: "ADEETIE", sectorOrCluster: "Foundry", ruleId: "AD-TS001", expectedClauseRef: "ADEETIE-SYN-6.1" },
  { scheme: "CCTS", sectorOrCluster: "Cement", ruleId: "MB001", expectedClauseRef: "CCTS-SYN-2.1" },
  { scheme: "CCTS", sectorOrCluster: "Cement", ruleId: "CV001", expectedClauseRef: "CCTS-SYN-4.1" },
  { scheme: "CCTS", sectorOrCluster: "Cement", ruleId: "LB001", expectedClauseRef: "CCTS-SYN-4.2" },
  { scheme: "CCTS", sectorOrCluster: "Cement", ruleId: "TS001", expectedClauseRef: "CCTS-SYN-6.1" },
  { scheme: "CCTS", sectorOrCluster: "Cement", ruleId: "SM001", expectedClauseRef: "CCTS-SYN-7.1" },
  { scheme: "CCTS", sectorOrCluster: "Cement", ruleId: "EF001", expectedClauseRef: "CCTS-SYN-8.1" },
];
