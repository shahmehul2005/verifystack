# Regulatory register

Every regulatory reference and threshold the product relies on, with its verification status
and the code that holds it. Nothing in the code is marked verified until a named person has read
it against the operative published source.

**How to verify an entry**

1. The domain reviewer reads the item against the current official document.
2. They fill in *Source*, *Verified by* and *Date* here, or correct the value.
3. An engineer updates the code location in the same pull request: remove the `TO VERIFY`
   marker, put the exact document and section in the clause string, and change the value if it
   was wrong. Update any test that asserts the unverified state.
4. Factor values are different: the platform steward cites them in the app at `/factors`. See
   [`../guides/platform-steward-checklist.md`](../guides/platform-steward-checklist.md).

Status key: **Unverified** (compiled, not read back) · **Verified** (read back; source recorded) ·
**Internal** (a product control, not a regulatory claim).

---

## 1. ADEETIE scheme parameters

These decide whether an enterprise gets money. They are hard gates.
Code: `backend/domain/packs/adeetie/scheme.ts`.

| Parameter                                | Value in code                         | Used by                  | Status     | Source | Verified by | Date |
| ---------------------------------------- | ------------------------------------- | ------------------------ | ---------- | ------ | ----------- | ---- |
| Minimum energy savings                   | 10%, achieved and sustained           | `AD-SAV001`, DPR exit    | Unverified |        |             |      |
| "Sustained" measurement window           | Not encoded                           | `AD-SAV001`              | Open       |        |             |      |
| Eligible loan size                       | ₹10 lakh – ₹15 crore                  | `AD-ELG003`              | Unverified |        |             |      |
| Maximum debt share of project cost       | 75%                                   | `AD-ELG004`              | Unverified |        |             |      |
| Interest subvention                      | 5% Micro/Small, 3% Medium             | `AD-ELG005`              | Unverified |        |             |      |
| Minimum net borrowing rate               | 2%                                    | `AD-ELG005`              | Unverified |        |             |      |
| IGEA/DPR cost reimbursement cap          | ₹75,000 Micro/Small, ₹1 lakh Medium   | DPR report               | Unverified |        |             |      |
| Cluster proximity provision              | 200 km from a notified cluster boundary | `AD-ELG002`            | Unverified |        |             |      |
| Udyam registration required              | Yes; format `UDYAM-XX-00-0000000`     | `AD-ELG001`              | Unverified |        |             |      |
| IGEA by empanelled auditor firm          | Yes                                   | Phase spec               | Unverified |        |             |      |
| DPR on the BEE template                  | Yes                                   | Phase spec               | Unverified |        |             |      |
| Implementation period                    | FY2025-26 to FY2027-28                | Scheme metadata          | Unverified |        |             |      |
| Outlay                                   | ₹1,000 crore                          | Scheme metadata          | Unverified |        |             |      |

## 2. ADEETIE notified clusters

Code: `backend/domain/packs/adeetie/clusters.ts` (`NOTIFIED_CLUSTERS`, 60 rows across 14 sectors).
Official list: <https://adeetie.beeindia.gov.in/list-of-eligible-clusters-under-adeetie-scheme>.

| Item                         | Status     | Notes                                                                 |
| ---------------------------- | ---------- | --------------------------------------------------------------------- |
| 14 Phase 1 sectors           | Unverified | `ADEETIE_SECTORS`                                                     |
| 60 cluster rows              | Unverified | Some rows came from a secondary source; the official page returned HTTP 500 when compiled |
| `CLUSTERS_VERIFIED` flag     | `false`    | Drives the "unverified" notice in the new-engagement wizard           |

To mark the list verified: correct every row against the official page, set
`CLUSTERS_VERIFIED = true`, rewrite `CLUSTER_SOURCE_NOTE`, and update the assertions in
`backend/domain/rules/adeetie.test.ts` and `backend/domain/packs/loader.test.ts`. Also change the
`info` finding text in `AD-ELG002` (`backend/domain/rules/adeetie.ts`), which says the list is
unverified regardless of the flag.

## 3. ADEETIE rule clause references

Code: `backend/domain/rules/adeetie.ts`, `ADEETIE_CLAUSE_REFS` in `scheme.ts`, citations in
`backend/domain/packs/adeetie/index.ts`.

| Rule        | Checks                                                   | Clause reference in code                                                    | Status     |
| ----------- | -------------------------------------------------------- | --------------------------------------------------------------------------- | ---------- |
| `AD-EB001`  | Billed vs metered energy within 3% (block above 9%)      | BEE General Guidelines for Energy Audit — energy balance closure            | Unverified |
| `AD-TS001`  | Baseline year has all 12 months                          | BEE General Guidelines for Energy Audit — a baseline year must be complete  | Unverified |
| `AD-CAL001` | Meter calibration valid over the reading period          | Legal Metrology / BEE audit guidelines — calibration validity               | Unverified |
| `AD-SEC001` | SEC within the plausible range for the sector            | Physical plausibility gate                                                  | Internal   |
| `AD-SAV001` | Savings meet the scheme minimum; periods comparable      | ADEETIE — minimum 10% savings, achieved and sustained                       | Unverified |
| `AD-ELG001` | Udyam number present and well-formed                     | ADEETIE — MSME must hold a valid Udyam Registration                         | Unverified |
| `AD-ELG002` | Notified cluster, or claimed ≤ 200 km                    | ADEETIE — notified cluster or within 200 km                                 | Unverified |
| `AD-ELG003` | Loan within ₹10 lakh – ₹15 crore                         | ADEETIE — eligible loan size                                                | Unverified |
| `AD-ELG004` | Debt ≤ 75% of project cost                               | ADEETIE — up to 75% debt funding                                            | Unverified |
| `AD-ELG005` | Claimed subvention matches category; net rate ≥ 2%       | ADEETIE — interest subvention and minimum net rate                          | Unverified |

## 4. CCTS rule clause references

Code: `backend/domain/rules/rules.ts`, pack citations in `backend/domain/packs/ccts/shared.ts`,
`cement.ts`, `ironSteel.ts`, `aluminium.ts`. The same string appears in the rule and in each pack;
change both. The desk review cites these same strings from one place,
`backend/domain/deskreview/clauses.ts`.

The project owner reported on 30 October 2026 that these references were confirmed against the
government source. The register records that statement; it does not name a verifier. A desk-review
check with no clause of its own is cited to the procedure as a whole and is not listed here.

| Rule    | Checks                                                       | Clause reference in code                                              | Status     |
| ------- | ------------------------------------------------------------ | --------------------------------------------------------------------- | ---------- |
| `MB001` | Opening + purchases − closing stock = consumption (0.5%)     | BEE CCTS Detailed Procedure Clause 4(5)(ii) & Section 5.20 — Fuel stock balance reconciliation and data control activities | Verified   |
| `CV001` | NCV used where NCV is required, not GCV                      | BEE CCTS Detailed Procedure Clause 4(6) & Annexure III — Mandatory NCV basis (5% solid/liquid default if lab unavailable) | Verified   |
| `CV002` | Calorific value within the plausible range for the fuel      | Physical plausibility gate                                            | Internal   |
| `LB001` | NABL accreditation valid on the test date                    | BEE CCTS Detailed Procedure Clause 4(8)–(10) & Section 5.14 — NABL accredited lab testing and valid accreditation | Verified   |
| `TS001` | No gaps in the monthly data series                           | BEE CCTS Detailed Procedure Clause 4(5)(i)(b) & Section 5.6 — Completeness of monthly monitored data series | Verified   |
| `EF001` | Grid factor vintage matches baseline compliance freeze       | BEE CCTS Detailed Procedure Clause 4(4)(vii) & Section 5.10(vi) — CEA grid emission factor frozen at baseline year | Verified   |
| `SM001` | Sampling: coal monthly or per 20,000 t; raw material monthly or per 50,000 t | BEE CCTS Detailed Procedure Clause 4(8)(iii) & Section 5.13 — Mandatory sampling frequency (coal monthly or per 20,000 t; raw material monthly or per 50,000 t) | Verified   |
| `MT001` | Aggregated discrepancies vs 2% statutory materiality         | BEE CCTS Detailed Procedure Section 6.12 & ISO 14064-3 — 2% statutory materiality threshold on aggregate discrepancies | Verified   |
| `DEV001`| External NABL vs internal lab deviation limit                | BEE CCTS Detailed Procedure Clause 4(10)(ii)–(iii) — NABL external vs internal lab deviation limit (±71.7 kcal/kg for coal per ISO 1928, ±2% for material) | Verified   |
| `REC001`| Renewable energy claims exclusion for RECs                   | BEE CCTS Detailed Procedure Clause 4(12)(iii) — Exclusion of Renewable Energy Certificates (RECs) from renewable energy claims | Verified   |
| `BIO001`| Exclusion of biogenic CO2 emissions from compliance total    | BEE CCTS Detailed Procedure Section 5.17 — Exclusion of biogenic CO2 emissions from compliance total | Verified   |
| `EXP001`| Power export emissions deduction                             | BEE CCTS Detailed Procedure Clause 4(11) / Section 5.16 — Net power export emissions deduction | Verified   |

## 5. CCTS sector definitions

Code: `backend/domain/packs/ccts/remaining.ts`. Each item changes the GEI denominator or which
emissions are counted, so a wrong definition silently misstates intensity.

| Sector             | Item to confirm                                                                    | Status     |
| ------------------ | ---------------------------------------------------------------------------------- | ---------- |
| Chlor-Alkali       | Equivalent product (NaOH equivalent); process emissions supplied as tCO2e          | Unverified |
| Pulp & Paper       | Equivalent paper sub-grade weighting; biogenic treatment of black liquor           | Unverified |
| Fertilizer         | Urea equivalent weighting; ammonia feedstock as mass-balance tCO2e                 | Unverified |
| Petrochemicals     | Sub-sector equivalent product (olefins, polymers, aromatics, fibre)                | Unverified |
| Petroleum Refining | Crude throughput vs CWT denominator; hydrogen production emissions                 | Unverified |
| Textiles           | Spinning / composite / processing weighting                                        | Unverified |

ADEETIE sector packs (`packs/adeetie/index.ts`) carry similar notes for product units in
Ceramics, Chemicals, Fisheries, Food Processing, Glass & Refractory, Pharma and Textiles.

## 6. Reference factors

Code: `backend/domain/factors/index.ts`. Every factor ships with `verified: false`. The platform
steward cites or corrects them in the app; verification is stored per organisation in
`factor_verifications`.

| Group                   | Factor IDs                                                                                     | Source in code                         |
| ----------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------- |
| Grid electricity        | `cea_grid_ef` (FY2024-25, FY2025-26)                                                           | CEA CO2 Baseline Database              |
| Fuel combustion         | `ef_coal_bituminous`, `ef_coal_subbituminous`, `ef_lignite`, `ef_natural_gas`, `ef_furnace_oil`, `ef_diesel`, `ef_petcoke`, `ef_coal_coking`, `ef_coke_oven_coke`, `ef_lpg`, `ef_naphtha`, `ef_refinery_gas`, `ef_charcoal` | IPCC 2006 GL Vol.2 Table 2.2 |
| Process emissions       | `ef_prebaked_anode`, `ef_pfc_anode_effect`, `ef_clinker_calcination`, `ef_steel_reductant_carbon`, `ef_ammonia_feedstock`, `ef_hydrogen_process` | IPCC 2006 Vol.3, CCTS Detailed Procedure |
| Energy content (ADEETIE)| `ec_coal_indian`, `ec_coke`, `ec_png`, `ec_lpg`, `ec_furnace_oil`, `ec_furnace_oil_volume`, `ec_diesel`, `ec_biomass_briquette` | BEE General Guidelines for Energy Audit; supplier GCV declarations |

Plausibility ranges (`NCV_PLAUSIBLE_RANGE`) and the 5% default materiality are internal controls,
not regulatory values.

## 7. Regulatory citation corpus

Tables: `regulatory_documents`, `regulatory_chunks`. The only corpus ingested so far is the
synthetic Foundry and Cement set from `backend/domain/citations/corpus.ts` (titles contain
`[SYNTHETIC]`, URLs use `example.invalid`). It must be deleted before any client sees a citation.

| Document to ingest                                   | Scheme  | Sector       | Status    |
| ---------------------------------------------------- | ------- | ------------ | --------- |
| ADEETIE operational guidelines (current edition)     | ADEETIE | General      | Not held  |
| CCTS Detailed Procedure for Compliance Mechanism     | CCTS    | General      | Not held  |
| Cement sector methodology                            | CCTS    | Cement       | Not held  |
| Foundry sector notes                                 | ADEETIE | Foundry      | Not held  |
| ADEETIE notified cluster annex                       | ADEETIE | General      | Not held  |

The retrieval threshold `MIN_RETRIEVAL_COSINE = 0.28` (`citations/types.ts`) is a starting
guess. Tune it against 15–20 labelled rule → clause pairs once real documents are in.

## 8. ECM library

Table: `ecm_library`. Empty. Rows come only from a published BEE sector ECM guide, reviewed and
signed by the domain reviewer. Format: [`../guides/auditor-onboarding.md`](../guides/auditor-onboarding.md) §4.

| Source guide | Sector | Rows | Reviewed by | Date |
| ------------ | ------ | ---- | ----------- | ---- |
|              |        |      |             |      |

## 9. Open items from DFD v3.1

Each of these was left unbuilt or conservative because the source is not in hand. Do not fill
them in from memory.

| Item | What the product does now | Needed to close | Status |
| ---- | ------------------------- | --------------- | ------ |
| Which schemes require an independent technical review | Pack field `technical_review_required` is off everywhere. The loader refuses to switch it on without a cited source. Only a reviewer's request for changes blocks sign-off. | The scheme document and clause, per scheme | Open |
| DPR financial ratios and thresholds (NPV, IRR, DSCR, debt-equity) | Not computed. `SAVINGS_DPR` reports savings and simple payback from recorded rupee savings, and says what it does not compute. | The BEE DPR template and the thresholds it uses | Open |
| CCTS annual-cycle stage list | No stage list on CCTS packs; the tracker does not appear. | The CCTS process, to define with a domain reviewer | Open |
| ADEETIE stage list | Taken from the DFD (EOI, IGEA, DPR draft, review, final, loan, M&V, closed). Moving a stage unlocks nothing. | Confirm against scheme operating guidance | Unverified |
| Sampling regime for low-risk values | Firm policy: 0.1 / 0.2 / 0.4 by plan risk, 0.2 default, minimum of three values. | If a scheme prescribes a sampling method, it replaces this | Internal |
| Scheme or portal submission templates (Form B, ICM, BEE) | One generic package, flagged `layoutUnverified`, stated in its README. | A real template and a sample accepted by the portal | Open |
| CBAM embedded emissions method | Structure only (`EMBEDDED_EMISSIONS`). No engagement can be opened. | The method, default values and the verification rules | Open |
| Green hydrogen intensity method | Structure only (`H2_INTENSITY`). No engagement can be opened. | The scheme's boundary, intensity definition and threshold | Open |
| Third-party evidence formats | Only VerifyStack's own evidence-pack format is imported. | A real sample from each external system | Open |
| Offline capture for fieldwork | A small browser queue with idempotent sync. | Confirm with verifiers that they need it | Open (user validation) |
| Entity response period | 14-day default, editable per issue. A firm default, not a scheme period. | Scheme period, if one exists | Internal |
| Coal GCV band, internal lab vs NABL (71.7 kcal/kg) | Enforced by `gcv_nabl_corroboration` as a pass/fail band, cited to Clause 4(10)(ii)-(iii) (rule `DEV001`, section 4). See the 71.7 rows below for what stays open. | Superseded. The clause is now in section 4 | Closed |
| Desk review cell band (0.5%) | Used only to compare one rounded cell with another, such as OPC 0.1 t. The opinion uses the 2% aggregate, not this band. | A band the scheme sets, per quantity | Internal |
| Equivalent product includes a clinker-export term (`B7/B13`) | The pro forma and Form 1 include it; the desk review recomputes it as the workbook defines it. | Confirm the term against the sector procedure | Open |
| Fuel oil in the cement pack | `furnace-oil` stream added, bound to `furnaceOil.quantity` and `furnaceOil.calorificValue` from the pro forma's GHG sheet. The engine prices it with `ef_furnace_oil` (IPCC 2006, 77.4 tCO2e/TJ, `verified:false`). The Shyamrock workbook uses 77.649 ("Annexure IV + GWP"), so the run's fuel-oil CO2 differs from the workbook's by about 0.3%. Same pattern as coal (96.1 against 96.586). | Confirm which factor CCTS requires for fuel oil, and whether the engine should use the workbook's own | Open |
| Petcoke and other fuels with no pro forma cell | A run leaves them out. Desk review reports `petcoke_cell` and `source_profile` until the plant states the quantity and factor. | Domain decision: add a petcoke stream, or state the pro forma does not carry it | Open |
| Desk review resolution states (resolved, accepted with explanation, unresolved immaterial, unresolved material, scope limitation) | `desk_resolutions` records the verifier's choice. Material and scope limitation hold sign-off through a block finding; accepted with explanation closes the finding with the reason logged; immaterial leaves it open without holding sign-off. The five names come from the cross-check DFD (CCTS 6.12, 6.13, 6.15), not from text this repo holds. | Confirm the names and the sign-off effect of each state with an energy auditor | Open |
| Annual figures resting on one month of evidence | Desk review reports `coverage_*` failures; it does not decide whether annualising is acceptable. | The scheme's rule on data coverage per parameter | Open |
| CCTS verification materiality, 2% of reported emissions | Desk review `materiality_aggregate` uses 2% of total reported direct and indirect GHG, taken from the ICAI-hosted copy of the CCTS Detailed Procedure. The 5% ISO 14064-3 figure recorded against MT001 in this register is not this threshold. | Confirm the 2% threshold against the BEE original | Open |
| Coal GCV ±71.7 kcal/kg as a pass/fail band | `gcv_nabl_corroboration` fails when the NABL and internal results differ by 71.7 kcal/kg or more, cites p. 14 of the Detailed Procedure, and does not replace the sample-frequency rule. It states the clause remedy (the excess is added to the internal lab parameter for that quarter) and does not apply it. | Three readings the text leaves open: the sign of the "difference" added back; whether the test is per quarter (clause 4(10)(i) and (v) disagree on quarterly and monthly samples); and what is compared when the NABL certificate covers a different period from the internal log | Open |
| Process (calcination) CO2 and the 2024-27 intensity basis | The Detailed Procedure, Section 3.4(1) Note, p. 7, sets the first targets on direct energy and indirect emissions and defers process emissions. A cement run therefore does not require a calcination figure when the compliance year falls in FY2024-25 to FY2026-27 (`FIRST_TRAJECTORY_PROCESS_BASIS`). It still counts a figure the plant supplies, adds a warning that says so, and changes no number. A year outside the window, or one that cannot be read, requires calcination as before. | Reading of "2024-27" as FY2024-25, FY2025-26 and FY2026-27; whether the achieved intensity should also exclude process emissions in those years, not only the requirement to supply them; the basis for the baseline year FY2023-24 | Open |
| Calcination methods are alternatives | The pack binds two calcination methods (clinker-based and raw-meal-based, Annexure II.G Eq. VIII-XIII, pp. 27-29) as `requiredGroup: "calcination"`. A run needs exactly one, and refuses a run that supplies both, since counting both would double the process CO2. | Confirm that one method must be chosen per plant and per year, and not used side by side | Open |
| The Note applied to other sectors | Applied to cement calcination only. Other sectors' `process_direct` streams are unchanged and stay required. | Whether the Note covers every sector's process emissions, or only those the cement pack lists | Open |
| Desk review evidence-period check | `evidence_period` compares the first and last dates of each dated series (SCADA, CPP, petcoke and coal log, lab samples) with 1 April to 31 March of the compliance year, and fails when any series reaches outside it. A free-text compliance year that cannot be read as a financial year makes the check not applicable. | Whether the scheme accepts evidence from an adjacent period, and under what conditions | Open |
| Desk review formula integrity | Compares the formulas in the plant's workbook with the templates this repo holds (`CEMENT_PROFORMA_FORMULAS`), and checks a cell against the template for the layout it matches. It reports an overwritten or missing formula; it does not decide whether an altered formula is wrong. | Sample pro formas from other plants, to extend the layout templates | Open |

## 10. Internal controls added with DFD v3.1

Product controls, not regulatory claims. They can be changed without a regulatory review, and any
change is a code change with a test.

| Control | Value | Code |
| ------- | ----- | ---- |
| Bulk-accept confidence floor (the same `CONFIDENCE_POLICY.reviewBelow` extraction already uses) | 0.9 | `domain/extraction/schemas.ts` |
| Bulk-accept batch limit | 500 values | `domain/triage/risk.ts` (`MAX_BULK_BATCH`) |
| Comparison tolerance (declared vs extracted) | 0.5% | `domain/compare/declared.ts` (`DEFAULT_TOLERANCE`) |
| Response link limits | 5 files of 10 MB; 20 requests per IP per 15 min; 30 per link per hour | `app/api/respond`, `lib/rateLimit.ts` |
| Fieldwork rate limit | 300 per 10 min per user | `lib/rateLimit.ts` |
| Evidence bundle cap in the package | 120 MB, beyond which files are indexed only | `lib/data/submissionPackage.ts` |
### Desk review controls

Working defaults the desk review uses where the procedure sets no band. None is a regulatory
claim and none is verified. The regulatory thresholds the desk review also uses (2% materiality,
coal GCV sample frequency) stay open in section 9 until a named person
confirms them.

| Control | Value | Code |
| ------- | ----- | ---- |
| Band for cross-document ties (DPR vs SCADA, SCADA vs monthly report, Form 1 recompute, evidenced total vs annual cell), reused from the declared-vs-extracted tolerance | 0.5% | `domain/deskreview/cement.ts` (`T`) |
| Rounding bands on tonnes and kWh ties | 0.5 t, 1 kWh | `domain/deskreview/cement.ts` (`TONNE_BAND`, `KWH_BAND`) |
| A month is thin when it has under half the rows of the series' typical month, on a series with at least 10 rows in a typical month | 50%, 10 rows | `domain/deskreview/engine.ts` (`THIN_MONTH_SHARE`, `DAILY_SERIES_MIN_ROWS`) |
| Slashed dates in a workbook are read day-first | dd/mm/yyyy | `domain/deskreview/engine.ts` (`isoDate`) |
| A figure typed from a PDF needs its source document and page | required | `app/api/desk-review/readings/route.ts` |
| GCV cell rounding band, when a caller passes one | 0 by default; not used by the desk review | `domain/crosscheck/tieout.ts` (`checkGcvRule`) |
| The smallest box a snip may have, as a share of the page | 0.5% of the page in each direction | `domain/deskreview/snip.ts` (`MIN_SIDE`) |
| Cited pages bound into a binder, and the largest cited file bound in | 60 pages; 30 MB | `domain/submission/binder.ts` (`maxEvidencePages`), `app/api/desk-review/binder/route.ts` |
