# Verification-first intake — implementation plan

Status: **plan only**. No product code in this change. This revision is based on
`do-res/` (procedures and the test archive), not on a guessed document list.

## 1. What was read

| File | What it is | Use in this plan |
| --- | --- | --- |
| `7772386525993811.pdf` (45 pp.) | BEE *Detailed Procedure for Compliance Mechanism under CCTS* | **In scope.** Form 1 (Annexure V), the undertaking that Form 1 matches the sector pro forma, Equation I–II (total GHG and intensity), cement process equations (Annexure II.G.1), GCV/NCV (Annexure III), IPCC-style factors including petroleum coke (Annexure IV), Form B. |
| `Cement.pdf` (202 pp.) | *Normalization Document and M&V Guidelines, Cement Sector* | **Out of scope for calculation.** It is the PAT normalization manual. The test set says not to implement normalization. It is cited only so those checks are not built. |
| `RTF-PDF-6bc4092848da03f9_…pdf` (60 pp.) | ACVA accreditation eligibility, July 2024 | Who may verify. It is not a plant evidence list. |
| `RTF-PDF-dd26de202535b101_…pdf` (88 pp.) | *Detailed Procedure for Offset Mechanism* | **Not this pipeline.** Headers only; body is mostly an image. Offset is not the compliance Form 1 path. |
| `RTF-PDF-d9cc8e301df47417_…pdf` (64 pp.) | No extractable text on the pages sampled | **Unread.** Treat as unseen until someone identifies it. Do not invent its contents. |
| `shyamrock_cement_works.zip` | Synthetic Shyamrock Cement Works, Chandrapur, 2023-24 | The test fixture. 16 files. Two of them are dropped from the required set (below). |

The ZIP still has **no** `manifest.json`. “Upload evidence pack” will keep rejecting it. That is correct. These files are ordinary evidence, not an evidence pack.

## 2. What the test archive actually contains

Workbooks were opened with the existing XLSX reader (values and formulas; formulas are not evaluated).

**Pro forma** `15_sector_specific_proforma.xlsx` — four sheets:

| Sheet | Role in the file’s own header | Treat as |
| --- | --- | --- |
| `1_Production` | Equivalent product. Inputs in column B (clinker production, export, import, OPC/PPC/PSC, clinker factors). Later rows are formulas. | **CCTS inputs.** Equivalent product is the intensity denominator. |
| `2_Energy_GtG_SEC` | Header says PAT gate-to-gate SEC, sourced from `Cement.pdf`, “not yet confirmed for CCTS”. Yellow inputs include process/power coal, fuel oil, GCVs, grid import/export, DG, CPP power, heat rates, thermal/electrical SEC of clinker. | **Do not use for normalization and do not block a CCTS run on it.** Keep the file so an auditor can see it. Do not apply PAT §10 eligibility (external-factor hours, petcoke uptake justification, kiln-log / SLDC proofs). |
| `3_GHG_CCTS` | Header says CCTS Tier 1, Annexure II/IV, direct and indirect energy only. States process emissions are out of scope for the 2024-27 trajectory. Inputs: total coal (t), fuel oil (t), GCVs, NCV factor, coal and fuel-oil factors, grid import, a grid factor marked VERIFY. | **The CCTS activity-data sheet.** Accepted yellow cells on this sheet are what a GHG run may use. |
| `4_Summary_Form1_Feed` | Every value row inspected is a formula back to sheets 1–3. Header quotes the rule that Form 1 is generated from the pro forma. Includes both “SEC without normalization” and “SEC normalized / GtG SEC”. | **The Form 1 comparison hub** for the fields we do check. The normalized SEC line is displayed and marked out of scope. It is not a number this product computes from `Cement.pdf`. |

Cached formula results in this file are **0**. Excel did not store calculated values. A click on a green cell must not propose `0`. Green cells are checked for “this is still a formula”. Totals are recomputed from the yellow inputs by code, or left blank until that recompute exists. They are never taken from the cached zero.

**Other files in the ZIP**

| File | In the required set? | What it holds |
| --- | --- | --- |
| `01_scada_production_trend.xlsx` | Yes | Daily clinker, OPC, PPC, PSC, kiln status `RUN` |
| `02`–`04` production PDFs and SAP printout | Yes | Corroborate production. Not opened as text in this pass (small synthetic PDFs). |
| `05_kiln_major_eqp_log.xlsx` | **No** | Present only for normalization eligibility. Do not require it. Do not build a check for it. |
| `06_cpp_daily_generation_report.xlsx` | Yes | Daily gross kWh, hours, heat rate |
| `07_cpp_monthly_generation_report.pdf` | Yes, trimmed | Generation total only. No internal-vs-external breakdown rule. |
| `08_coal_internal_lab_report.xlsx` | Yes | Daily GCV, ash, moisture, hydrogen |
| `09` NABL certificate PDF | Yes | External GCV check against the internal lab |
| `10` coal purchase order PDF | Yes | Corroborates coal. Does not fill a pro forma cell by itself. |
| `11_petcoke_consumption_log.xlsx` | Yes as data, **gap as a destination** | Daily coal and petcoke tonnes. Sheet 3 has coal and fuel oil only. No petcoke input cell. |
| `12` grid bill PDF | Yes | Grid import. Same figure should match Sheet 3 grid import (and Sheet 2 if that sheet is shown). |
| `13` REC PDF | Yes as a presence check | Sheet 3 has no line that subtracts renewable electricity. |
| `14_sldc_external_factor_letter.pdf` | **No** | Normalization evidence. Do not require it. |
| `16_form1_annual_energy_ghg.pdf` | Yes | The entity’s claim. Compared with Sheet 4, not used as a calculation input. |

The file’s own footer says it is a synthetic fixture for pipeline testing. Cell addresses above are for **this fixture**. They are not a notified BEE template. Another plant’s pro forma will not use `B6` for clinker.

## 3. What “CCTS, no normalization” means here

From the compliance procedure, the result that matters is:

- Total GHG = direct energy + direct process + indirect electricity and heat − allowed adjustments (Equation I).
- Intensity = total GHG / equivalent output (Equation II).
- Cement process emissions are specified (clinker CaO/MgO, CKD, bypass dust, organic carbon). The **sample Sheet 3 header says process emissions are out of scope for the 2024-27 trajectory.** Do not turn Equation IX–XIII on for this fixture until that header and the procedure are reconciled by a person. Until then, process CO₂ stays an open item in the regulatory register, and the run states that process emissions were not included.
- Form 1 Section B prints both “without normalization” and “normalized” lines, because the form still has PAT-era rows. This product fills and checks the without-normalization energy line only as a **display from Sheet 2 if an auditor asks to see it**, and it checks GHG lines from Sheet 3 / Sheet 4. It does not compute a normalized SEC and it does not read `Cement.pdf` §10.

Dropped on purpose (test brief and the instruction not to do normalization):

- Kiln major-equipment log and SLDC letter as required documents.
- CPP hours split into internal vs external causes.
- Petcoke “external factor” justification.
- Any normalization eligibility pass/fail.

What still runs as ordinary checks, with no normalization consequence:

- SCADA day with production 0 and status not `DOWN` (or not `RUN` in this fixture) is a finding, not a normalization adjustment.
- SCADA monthly sum compared with the Sheet 1 production input (tolerance for the daily log, exact for a document that is supposed to be the source of the cell).
- DPR: signature present; recomputed SEC only as a plausibility band, not an engine input.
- MPR: mass balance Opening + Production + Import − Export − Closing, and exact match to the Sheet 1 yellow cells it is supposed to populate.
- SAP printout: signature, quantity vs MPR.
- CPP daily sum vs the annual CPP figure the auditor is tying (Sheet 2 cell in the test brief). For the CCTS run, CPP kWh is not an Equation II input unless Sheet 3 uses it. Sheet 3’s electricity input in this file is grid import only. Do not silently add CPP generation into grid emissions.
- CPP monthly: generation total ties to the same CPP figure; PAF/PLF is an informational recompute, not a gate.
- Internal coal lab: sampling cadence; the GCV is the candidate for Sheet 3’s GCV cell (the test brief also names Sheet 2).
- NABL: the test brief’s rule is absolute deviation of 71.7 kcal/kg, and if it is exceeded the **corrected** GCV must be the yellow cell, not the raw lab average. That threshold was **not** found in the pages extracted from the compliance procedure. Encode it only as a named constant with source “test brief, confirm against the certificate method” until a person points at the clause. Do not invent a second threshold.
- Purchase order: match to lab/quantity narrative; no pro forma cell of its own.
- Petcoke log: sum tonnes. Finding: “no Sheet 3 cell for petcoke” while the log shows about 10% of kiln fuel. The GEI pack already has an optional `petcoke-kiln` stream. The fixture pro forma does not. Do not stuff petcoke into the coal tonne cell.
- Grid bill vs the Sheet 3 grid-import cell. One corroborated figure, not two different numbers on Sheet 2 and Sheet 3.
- REC: presence / “no renewable claim” check. Finding if a renewable claim exists and Sheet 3 has no subtraction. Do not invent the subtraction.

## 4. Target pipeline

```text
Upload many files (store + hash only)
  → Assign each file to a slot (many files per slot)
  → Required slots have at least one file
  → Mark exactly one workbook as this engagement’s pro forma
  → Click yellow input cells → bind to pack paths
  → Green cells: formula still present? recompute; never accept a typed-over formula
  → Supporting file in the linked slot agrees with that cell
  → Auditor accepts the cell, corrects it, or rejects it
  → Accepted spreadsheet facts only (plus an explicit override)
  → Existing mapper and GEI engine
  → Sheet 4 / Form 1 field check on the result, not a second calculator
```

Upload does not extract and does not calculate. Extract stays a separate action on PDFs and images. Workbooks are not sent to the vision model.

## 5. Checklist for this fixture

Required before a **new** run (one file is enough to tick the slot):

1. Pro forma workbook (the file marked pro forma).
2. Production evidence: SCADA or MPR (both may be attached; one ticks the slot).
3. Coal quantity/quality: internal lab **or** NABL **or** purchase order. The NABL slot is separately required if the lab GCV is used as the Sheet 3 GCV.
4. Grid electricity bill.
5. Form 1 (the claim). A run may be drafted without it; **submission** waits for Form 1 vs Sheet 4. State that split in the UI so “calculate” is not blocked on a PDF that is the output of the audit, while “ready to compare the claim” is.

Not required:

- Kiln equipment log, SLDC letter.
- CPP daily/monthly, DPR, SAP, petcoke log, REC: show them as optional corroboration. Missing does not block the run. Present and inconsistent raises a finding.

Several files under one label stay allowed (three bills under grid electricity).

Cement’s current seven taxonomy entries (`fuel_invoice`, `tax_invoice`, `electricity_bill`, `lab_certificate`, `production_log`, `weighbridge_slip`, `monitoring_plan`) stay for other engagements. This fixture needs **additional** pack document types, not a rename of those seven. Suggested ids: `proforma_workbook`, `form1`, `scada_production`, `dpr`, `mpr`, `sap_production`, `cpp_daily`, `cpp_monthly`, `coal_lab_internal`, `coal_purchase_order`, `petcoke_log`, `rec_declaration`. `lab_certificate` is the NABL file. `electricity_bill` is the grid bill. `production_log` can be the MPR if we do not want two production ids; prefer a distinct `mpr` so SCADA and MPR can both be ticked.

`requiredForCalc` is data on those types. Default off in every pack except the types listed as required above, and only on the cement pack used for this pilot until a reviewer confirms the list.

## 6. Click-to-map

On the workbook marked pro forma:

- Grid from the existing parser. Click selects the cell. Show value, formula, and whether the cell is an input (no formula) or a formula cell.
- Bind **input** cells only, many per submit, to existing pack paths: coal quantity, fuel-oil quantity, coal GCV, grid electricity, and the production quantities the equivalent-product step needs (clinker, OPC, PPC, PSC, clinker factors). Units come from the binding. The button text says the cells go to the review queue and are not in a run until accepted.
- Formula cells: a separate “formula still there” check across the sheet (cell has a formula string). A formula cell with a cached typed number and no formula is a finding (“green cell overwritten”). Do not offer “accept this formula cell as a fact”.
- Do not evaluate the workbook’s formulas inside the spreadsheet. Recompute the CCTS totals in our code from accepted inputs (section 7). Comparing that recompute to Sheet 4 is the “independent total” check. If the cached value is 0, say “workbook did not store a calculated total; the total below is VerifyStack’s”.

Time-series books (SCADA, lab, CPP, petcoke) keep window mapping: click the date column and the value column, set start, end, and one of the existing aggregations (sum for tonnes and kWh, mean for GCV). The server recomputes. A zero-production day without a down status is a row-level finding, not an aggregate.

## 7. What changes in the product (no new calculator)

| Area | Change |
| --- | --- |
| Upload | Multi-select PDF, PNG, JPEG, WebP, XLSX, CSV. Each file uses today’s ingest (hash, type from bytes, size cap). Response copy: stored, not read. |
| Evidence-pack ZIP | Unchanged verifier. If `manifest.json` is absent, the error names multi-file upload and says a plant folder is not an evidence pack. |
| Documents page | Checklist from the pack taxonomy. Assign a document to a slot. One slot, many files. Tick when count ≥ 1. One document flagged `proforma`. |
| Table mapper | Click grid and multi-bind for the pro forma. Typed sheet/cell remains a fallback. Propose route stays the writer of review items; it already re-reads the file. |
| Compare | For each bound input, show the cell and any extracted field on documents in the linked slot. Same tolerance as now. Mismatch blocks quiet accept. |
| Facts allowed into a run | `spreadsheet_cell` or `time_series_range` that an auditor accepted, or an explicit “no workbook” override with a note. `document_page` facts stay on the ledger and are omitted from the run. The Calculation page states how many workbook values were used and how many PDF readings were not. |
| Engine | `mapFactsToCalcInput` and the GEI/SEC formulas stay. The filter is in front of the mapper. Draft mode does not skip it. |
| Equivalent product | Sheet 1’s formula is a clinker-factor conversion into major product (PPC in this file). The current cement pack’s production binding is not that formula. **Do not silently replace it.** Add a pack-level equivalent-product method only after the Sheet 1 formulas (rows that were cut off in the preview, including `B21`) are written down and checked against the procedure’s “total equivalent product”. Until then, map the accepted tonne inputs and show “equivalent product not computed from Sheet 1; open item”. |
| Petcoke | No new factor. The pack already has `ef_petcoke` / `petcoke-kiln`. Add a Sheet 3-style binding only when the pro forma has a cell. Until then the petcoke log raises the gap finding and its tonnes are not added to coal. |
| REC | No subtraction in the engine. Presence of a renewable claim raises a finding that Sheet 3 cannot exclude it. |
| Process CO₂ | Leave the existing clinker stream as it is (optional, omitted when facts are absent). Do not require CKD/bypass/organic-carbon facts for this fixture. |
| Form 1 | After a run, compare the run’s equivalent product (if computed), direct energy CO₂, indirect CO₂, total, and intensity to Sheet 4 formula outputs we recomputed, and to Form 1 fields if that PDF has been extracted. Normalized SEC is listed as “not checked”. A Form 1 number with no Sheet 4 counterpart is “unverifiable”. |
| Normalization | No new rules, no §10 gates, no required kiln log or SLDC slot. |

## 8. Build order

1. Multi-file upload and the clearer ZIP error.
2. Slots, assignment, pro forma flag, checklist. Required flags only for the five slots in section 5.
3. Click-to-map and formula-integrity listing on the pro forma. Propose many input cells at once.
4. Time-series column pick for SCADA, lab, CPP, petcoke, using the current aggregation server.
5. Side-by-side compare of a bound cell to extracted PDF fields in the linked slot.
6. Run filter: accepted workbook facts only, with the Calculation page counts.
7. Cross-document checks that do not change the engine: SCADA sum vs Sheet 1 cell, MPR mass balance and exact cell match, NABL deviation vs the GCV cell (threshold marked unconfirmed), petcoke-with-nowhere-to-go, REC-with-no-exclusion, zero-production day, formula cell overwritten.
8. Recompute Sheet 3 totals from accepted inputs with the existing fuel and electricity streams, and show them next to Sheet 4. Form 1 field compare when extraction exists.
9. Only then decide equivalent-product and process-emission scope, in the regulatory register, not in a hurry to make this ZIP go green.

## 9. Still unresolved

- The 64-page image PDF in `do-res/` has no title we could read.
- Sheet 1 rows below 18, including the equivalent-product total the Sheet 4 formula calls `B21`, were not fully listed. Read those formulas before coding equivalent product.
- Whether 2024-27 cement intensity really excludes process CO₂, as the fixture header claims, against Annexure II.G.1 which specifies it. Partly settled: Section 3.4(1) Note, p. 7, sets the first targets on direct energy and indirect emissions. The pack waives the calcination requirement for FY2024-25 to FY2026-27 and still counts a supplied figure (see the register, section 9).
- The 71.7 kcal/kg NABL band: now cited to Clause 4(10)(ii)-(iii), p. 14 of the Detailed Procedure (register rule `DEV001`). The sign of the added-back difference and the quarterly basis stay open.
- Official blank pro forma. This XLSX is synthetic. Bindings are per workbook, not hard-coded `B6`.
- Grid factor on Sheet 3 is labelled VERIFY. The pack’s `cea_grid_ef` vintage stays the pack’s problem; do not copy `0.716` out of the fixture into the factor table.
