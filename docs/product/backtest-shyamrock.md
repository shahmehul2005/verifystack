# Backtest: Shyamrock Cement Works test set

Status: **backtest run, prototype partly rebuilt.** Tests: `backend/domain/crosscheck/shyamrock.backtest.test.ts`
(15 checks, reads `do-res/shyamrock_cement_works.zip`). Numbers below were produced by that code.

## 1. Will the prototype work on this test set?

**Before this change: no.** Four things break, in this order:

1. The ZIP is refused. It has no `manifest.json`, so the evidence-pack importer rejects it. The
   error now says it is a plant folder and points at multi-file upload.
2. Uploads read files. A single upload auto-extracted PDFs, so the first step was slow and
   opaque. Now upload stores only, and reading is a separate step.
3. A calculation used every fact in the engagement, PDF readings included. Nothing said a
   workbook value was needed. Now a pack with `workbook_required` uses only accepted workbook
   and time-series facts, plus site observations and explicit overrides. The flag is **off** for
   the existing cement pack (see section 5).
4. Nothing checked cross-document agreement. The checks now exist as tested functions. They are
   **not yet on a screen.** An auditor cannot see a tie-out result in the product today.

**After this change, on this test set:** the arithmetic works. Every check runs, and the
reproductions match the workbook and Form 1 closely. But the test set cannot show that the checks
catch errors, because most of it was built from the answer. Section 3 explains why.

## 2. Backtest results

| # | Check | Result | Numbers |
| --- | --- | --- | --- |
| 1 | SCADA clinker, 30 date rows, vs MPR clinker | **pass** | 12,500 t vs 12,500 t |
| 2 | SCADA OPC vs MPR OPC, exact | **fail** | 6,058.2 vs 6,058.3 (−0.1 t, one-decimal rounding) |
| 2b | Same, relative band 0.5% | pass | band 30.3 t |
| 3 | Production days: zero-output days without DOWN, output on DOWN days | **fail** | 2023-11-26 is `DOWN (maint.)` with **454.2 t** of clinker |
| 4 | DPR vs SCADA on the five sampled days (0.5% band) | **fail** | −13.6% (11-03) to +11.8% (11-02) |
| 5 | Clinker mass balance, implied outflow vs clinker consumed for cement | pass (rel. band) | outflow 14,166.7 t; consumed 14,166.8 t (OPC 0.96, PPC 0.75, PSC 0.70) |
| 6 | Pro forma annual clinker (150,000 t) evidenced by months | **fail** | 1 of 12 months; equals November MPR × 12 |
| 7 | CPP generation, November × 12 vs pro forma 110.2 Lakh kWh | pass | 110.2001 vs 110.2 |
| 7b | CPP evidence coverage | **fail** | 1 of 12 months |
| 8 | Grid bill, 250,000 kWh × 12 vs pro forma 30 Lakh kWh | matches | 30.0 vs 30 |
| 8b | Grid evidence coverage | **fail** | 1 of 12 bills |
| 9 | Coal purchase order, 2,914.2 t × 12 vs Sheet 3 34,970 t | pass (rel. band) | 34,970.4 vs 34,970 |
| 10 | Coal: petcoke log coal (November) vs purchase order (November) | **fail** | 1,875 t vs 2,914.2 t |
| 11 | Petcoke logged, no pro forma cell | **fail** | 208.4 t in November; no cell |
| 12 | NABL vs internal GCV, 71.7 kcal/kg rule | pass | deviation 30; workbook holds 4,200 (internal) |
| 13 | REC declaration | pass | nil claim; REC purchases are not a claim (procedure p.14, 4(12)(iii)) |
| 14 | Form 1 total equivalent product | pass (rel. band) | recomputed 240,002.67 vs claimed 240,003 |
| 15 | Form 1 direct energy CO2 from Sheet 3 inputs and the sheet's factors | pass | recomputed 56,794.75 vs 56,794.8 (−0.05 t) |
| 16 | Form 1 indirect CO2 = grid × 0.716 | pass | 2,148.0 vs 2,148.0 |

Also measured, not a pass/fail check:

- The November internal lab GCV mean is **4,188** kcal/kg. The pro forma holds **4,200**, the
  internal certificate value. The difference is 12 kcal/kg, inside the 71.7 band, so the rule
  does not fire. The annual figure is still not shown to be a mean of the lab data.
- Form 1 **thermal** energy (145,357 Mkcal) reproduces exactly from Sheet 2's formula:
  `(coal process + coal power) × GCV × 100 + fuel oil × GCV × 100 − exported power × 2,717/10`.
  The deduction of 2,717 Mkcal is **exported electricity**, a PAT-method term. It is not part of
  the CCTS GEI run. See section 4.

## 3. Why passing here does not prove the checks work

- **The monthly data was built from annual numbers.** The SCADA footer says "annual figures,
  pro-rated to this sample month". The CPP and grid documents are annual or annualised values
  carried into one month. The pro forma equals November × 12 for clinker, OPC, PPC, PSC, exports,
  imports, grid, CPP and coal. A check that ties a monthly sum to a pro forma cell passes by
  construction.
- **Only one month exists.** The pro forma is a 2023-24 annual submission. Twelve monthly
  sources are needed to evidence it. The checklist and checks 6, 7b and 8b say so.
- **No seeded errors.** A real test needs documents with known mistakes: a transposed digit,
  a day moved between months, a DOWN day with output, a typed-over formula. Only #3 (the DOWN day)
  is a real contradiction in this set; the others were not seeded deliberately.

**Recommendation:** build a seeded copy of this set (for example 5 errors across 4 documents,
recorded in an answer key) before any claim about detection rate.

## 4. Findings the auditor would raise (from the test set)

1. **DOWN day with output.** 2023-11-26: status `DOWN (maint.)`, clinker 454.2 t.
2. **DPR and SCADA disagree** on the same five days by up to 13.6%. One of them is wrong.
3. **Three different November coal figures.** Purchase order 2,914.2 t; petcoke log 1,875 t
   (coal consumed); pro forma 34,970 t per year, which is the purchase order × 12. The petcoke
   log does not reconcile to the purchase order, and the pro forma has no monthly link to either.
4. **Petcoke has no destination.** 208.4 t in November, about 10% of kiln fuel. Sheet 3 has no
   petcoke line. Not added to coal.
5. **Equivalent product includes clinker exports.** The sheet's formula adds
   `clinker export ÷ 0.75` (about 13,333 t) to cement equivalent output. Clinker sold is not
   cement ground. The procedure's definition of equivalent output needs checking before this
   goes to a verifier.
6. **Form 1 thermal energy depends on the PAT formula.** It deducts exported electricity at
   2,717 kcal/kWh. The CCTS GEI method has no such term. The Form 1 claim and the GEI result will
   differ unless this is decided.
7. **All 25 formula cells in the workbook are stored as 0.** It did not save calculated values
   on any sheet, so Sheet 4 and the GHG and energy totals cannot be read as results. Totals must be
   recomputed from the input cells (check 15 does this for direct CO2).
8. **Formula integrity cannot be run.** The check compares a clean template with the submitted
   workbook. Only one copy of the pro forma exists, so there is no template. The check is built
   and tested, but it cannot run on this set.
9. **Source notes cite the normalization document.** Several sheet headers and fixture notes cite
   `Cement.pdf` (§9.1–§10.4), the normalization manual. Excluded here, but the workbook itself is
   built on it.
10. **The 71.7 kcal/kg threshold** is in the test brief. It was not found in the procedure pages
    read, so it is treated as unconfirmed.
11. **Grid emission factor 0.716** is marked VERIFY in the fixture. It is not taken as a value.

## 5. Changes to the brief (be critical)

- **The mass balance cannot pass as written.** Opening + production + import − export − closing
  leaves 14,166.7 t, which is not checked against anything. It closes only against clinker
  consumed for cement (cement × clinker factor), within 0.1 t. Add that term to the brief.
- **"Must be exact" is wrong for one-decimal sources.** OPC differs by 0.1 t from rounding. Use a
  band that depends on the source's precision, and say what that band is. The brief names no band.
- **"Within a tolerance band" needs a number.** The product's existing comparison tolerance is 0.5%.
  That is a product default, not a CCTS value. Confirm one with a practitioner.
- **Sheet 1 is annual; SCADA is monthly.** The brief's "sum the month and tie it to Sheet 1" only
  works if twelve months exist. Make the check annual-to-twelve-months, and flag any annual cell
  with fewer months behind it.
- **Form 1 equality against Sheet 4 is equality with a recomputation,** because Sheet 4 holds
  cached zeros. Say that in the brief.
- **The REC gap is narrower than stated.** The procedure says REC purchases are not a renewable
  claim. The exclusion gap only matters for onsite generation or open access / PPA procurement.
- **Normalization is not fully out of the workbook.** Sheet 2 and Form 1 thermal depend on it.
  Choose: ignore the PAT sheet for CCTS, or confirm the PAT term is wanted.

## 6. What was built

| Area | What | Where |
| --- | --- | --- |
| Checklist | Slots with `run` / `submission` / `none` gates; ticks when one document is assigned; several per label | `backend/domain/crosscheck/checklist.ts`, `packs/types.ts`, `packs/ccts/cement.ts` |
| Run gate | Runs refused until every `run` slot has a document; packs without slots unaffected | `frontend/app/api/runs/route.ts` |
| Slot assignment | Migration `0016_document_slots.sql`; `PATCH /api/documents/[id]/slot`, pack-checked, audit-logged | `backend/supabase/migrations/`, `frontend/app/api/documents/[id]/slot/` |
| Checklist UI | Label ticks and per-document assignment on the Documents page | `slot-checklist.tsx` |
| Upload | Several files at once; stored only, nothing read; Extract stays a separate button | `upload-form.tsx` |
| Click-to-map | Clicking a cell in the sheet preview adds it to the propose list; the button's purpose is explained | `table-mapper.tsx` |
| ZIP error | Plant folder → points to multi-file upload | `backend/domain/intake/evidencePack.ts` |
| Run filter | `workbook_required` keeps workbook, time-series and site facts only; PDF readings excluded with a reason | `backend/domain/crosscheck/runFacts.ts`, wired in `runs/route.ts` |
| Tie-outs | Sum-to-target, daily agreement, mass balance, evidence coverage, GCV rule, production days, unmapped fuel, renewable claim, formula integrity, recomputation | `backend/domain/crosscheck/tieout.ts` |
| Tests | 46 unit tests plus 15 backtest tests against the real ZIP | `backend/domain/crosscheck/*.test.ts` |

## 7. Not built, and why

- **Tie-out results on a screen.** The auditor cannot see a check result yet. Needs an API that
  reads the workbook and the extracted PDF readings together.
- **Override table.** `workbook_required` reads overrides from a set that nothing stores yet.
- **Workbook rule not enabled.** Changing which facts a run uses changes results. The cement pack
  is version 1.0.0, and existing engagements are pinned to it. Enabling it means a new pack version
  and rebinding engagements. Your decision (section 8).
- **Click-to-map limits.** The grid shows values only, not formulas. Cells beyond the 40 × 12
  preview are typed in by hand. Mapping is per workbook; nothing is hard-coded to `B6`.
- **Side-by-side PDF comparison** for a bound cell.
- **Equivalent product and process CO2** are not computed. Open items (section 4.5).
- **Migration 0016 and UI not run against a live database or in a browser.** The gate gives
  typecheck, unit, and build results only.

## 8. Decisions needed

1. Turn on `workbook_required` for cement? That needs pack version 1.1.0 and a rebind of existing
   cement engagements. Or create a separate pilot pack id so existing engagements are untouched.
2. Is equivalent product's clinker-export term right? Check against the procedure's definition.
3. Ignore the PAT (Sheet 2) formulas for CCTS, or keep the thermal figure on Form 1 as the entity
   reports it?
4. Who confirms the slot list and the `run` gates for the pilot?
5. Build the seeded error set (section 3) before quoting any detection rate?
