# Glossary

Terms used in the product, the code and the schemes. Code identifiers are shown where the term
maps to one.

## Schemes and institutions

| Term        | Meaning |
| ----------- | ------- |
| **BEE**     | Bureau of Energy Efficiency, Ministry of Power. Administers CCTS and ADEETIE. |
| **CCTS**    | Carbon Credit Trading Scheme. Obligated entities must meet notified GEI targets; results are verified by accredited agencies. |
| **ADEETIE** | Assistance in Deploying Energy Efficient Technologies in Industries & Establishments. Interest subvention for MSMEs that adopt energy-efficient technology and prove the savings. |
| **PAT**     | Perform, Achieve and Trade. The earlier BEE scheme; its normalisation pro-formas are still cited for some sectors. |
| **ICM**     | Indian Carbon Market. The registry and portal where CCTS results are filed. Out of scope for VerifyStack. |
| **CEA**     | Central Electricity Authority. Publishes the CO2 Baseline Database (grid emission factor). |
| **IPCC 2006 GL** | IPCC 2006 Guidelines for National Greenhouse Gas Inventories. Default fuel and process emission factors. |
| **NABL**    | National Accreditation Board for Testing and Calibration Laboratories. Lab certificates must come from a NABL-accredited lab. |
| **ISO 14064-3** | Standard for validation and verification of GHG statements; source of the materiality concept. |
| **Legal Metrology** | Indian law governing measuring instruments and their calibration. |

## People and roles

| Term | Meaning |
| ---- | ------- |
| **ACVA** | Accredited Carbon Verification Agency. The CCTS verifier and a VerifyStack customer. |
| **Empanelled energy auditor** | BEE-empanelled auditor firm that performs the ADEETIE IGEA and M&V. A VerifyStack customer. |
| **Obligated entity** | A CCTS plant with a notified GEI target. The audited party, never a customer. |
| **Enterprise / applicant** | The MSME applying under ADEETIE. The audited party, never a customer. |
| **Registered FI** | Financial institution that sanctions the ADEETIE loan. |
| `firm_admin` | Runs the firm in VerifyStack: team and audit log. No verification powers. |
| `lead_verifier` | Owns an engagement: creates it, runs calculations, signs as lead. |
| `verifier` | Uploads, extracts, reviews and works findings. Cannot sign. |
| `independent_reviewer` | Reviews and gives the second, independent signature. |
| **Platform steward** | A VerifyStack operator (listed in `VERIFYSTACK_STEWARD_EMAILS`) who cites and corrects reference factors. |
| **Domain reviewer** | The empanelled auditor who verifies regulatory content and the ECM library for the platform. |

## Metrics and calculation

| Term | Meaning |
| ---- | ------- |
| **GEI** | Greenhouse gas Emission Intensity: tCO2e per tonne of equivalent product. The CCTS metric. |
| **SEC** | Specific Energy Consumption: energy per unit of production. The ADEETIE metric; the packs report GJ per tonne. |
| **Equivalent product** | The production denominator for GEI, defined per sector (e.g. tonnes of cement, urea equivalent). |
| **Scope 1** | Direct emissions: fuel combustion and process emissions on site. |
| **Scope 2** | Indirect emissions from purchased grid electricity. |
| **Process emissions** | Non-combustion emissions, e.g. clinker calcination, anode consumption, ammonia feedstock. |
| **GCV / NCV** | Gross / Net Calorific Value of a fuel. CCTS emissions use NCV; bills often state GCV. |
| **Emission factor** | kgCO2e per unit of energy or activity, with a source and vintage. Code: `ef_*`, `cea_grid_ef`. |
| **Energy content factor** | Calorific value used to convert a fuel quantity to energy for SEC. Code: `ec_*`. |
| **Vintage** | The year or edition a factor applies to, e.g. `FY2025-26`, `IPCC2006`. |
| **Materiality** | Size of misstatement that would change a verification opinion. Default 5% (`DEFAULT_MATERIALITY_PCT`). |
| **Compliance year / baseline year** | The financial year being verified, written `FY2025-26` (April to March). Stored as `compliance_year`. |
## ADEETIE lifecycle

| Term | Meaning |
| ---- | ------- |
| **IGEA** | Investment Grade Energy Audit. Establishes the baseline SEC, energy balance and candidate measures. |
| **DPR** | Detailed Project Report on the BEE template: measures, projected savings, project cost, loan and subvention. |
| **M&V** | Monitoring & Verification after implementation. Measures post-implementation SEC and savings against the baseline. |
| **Baseline** | The IGEA-period SEC. Locked once IGEA closes. Code: `SecPhase = "baseline"`. |
| **Energy balance** | Reconciliation of billed energy against metered energy across the audit boundary. |
| **Interest subvention** | Percentage points of interest the scheme pays on the enterprise's loan. |
| **Udyam Registration** | MSME registration number issued on the Udyam portal, `UDYAM-XX-00-0000000`. |
| **Notified cluster** | An industrial cluster listed by BEE as eligible for ADEETIE. |
| **Micro / Small / Medium** | MSME category. Drives subvention rate and reimbursement cap. |

## Product concepts

| Term | Meaning |
| ---- | ------- |
| **Engagement** | One verification job for one plant and period, bound to one methodology pack. |
| **Methodology pack** | A data record describing a sector: document types, field schemas, calculation method, factors, bindings, rules and clause citations. Code: `MethodologyPack`. |
| **Binding** | Maps a pack stream ID (e.g. `coal-kiln`) to the fact field paths it reads. |
| **Evidence / document** | An uploaded file, stored under its SHA-256 hash. |
| **Extracted field** | A value proposed by extraction, with provenance, awaiting review. |
| **Fact** | An extracted field a human accepted or corrected. Only facts feed calculations. |
| **Provenance** | Document ID, page, bounding box and verbatim source text for a value. |
| **Facts ledger** | The engagement's list of accepted facts. |
| **Run** | One calculation over the facts, with engine version, pack version, input hash and chain hash. |
| **Chain hash** | Hash of a run's input hash and the previous run's hash, making the run history tamper-evident. |
| **Finding** | A rule result with severity `block`, `warn` or `info`. An open `block` prevents sign-off. |
| **CAR** | Corrective Action Request. The finding language sent to the client, drafted from a template. |
| **Citation** | A retrieved regulatory clause attached to a finding. Gate: `grounded`, `rejected`, `no_applicable_clause`, `unavailable`. |
| **Groundedness gate** | Code that checks model output only uses the records the model was given. |
| **ECM** | Energy Conservation Measure. A library row suggested when it matches the facility. |
| **Maker–checker** | Two different people must sign: the lead verifier and the independent reviewer. |
| **Draft mode** | Legacy engagement flag (`draft_mode`). New engagements are created with it off and there is no UI toggle. |

## DFD v3.1 terms

| Term | Meaning |
| ---- | ------- |
| **Provenance type** | How a fact was sourced: `document_page`, `spreadsheet_cell`, `time_series_range` or `site_observation`. |
| **Declared value** | What the entity states (in an evidence pack or typed in), kept apart from facts and compared with what was extracted. Never a fact. |
| **Low-risk value** | A page-read, non-material, high-confidence, auto-commit value that matches any declared value. The only kind that can be bulk accepted. |
| **Review sample** | The deterministic share of low-risk values a person must review one by one before bulk accept opens. |
| **Verification plan** | The verifier's risk ratings, sampling rate and site-visit decision. Saved as immutable versions. |
| **Site visit / observation** | A scheduled visit, and something seen on it. An observation becomes a fact only when someone else accepts it. |
| **Issue** | A finding once it is being worked as a conversation with the entity: `open`, `responded`, `verified`, `closed`. |
| **Response link** | A signed, expiring, one-time link that lets the entity answer one issue without an account. |
| **Technical review** | The independent reviewer's approve or changes-requested decision, bound to a hash of the run and accepted facts. A change makes it stale. |
| **Submission package** | A ZIP of facts, calculation record, findings, sign-offs and evidence with hashes. Its layout is generic. |
| **Stage** | Where an ADEETIE engagement sits in the scheme's journey (expression of interest to closed). A tracker only. |
| **Structure-only pack** | A methodology described but not implemented (CBAM embedded emissions, green hydrogen intensity). No engagement can use one. |