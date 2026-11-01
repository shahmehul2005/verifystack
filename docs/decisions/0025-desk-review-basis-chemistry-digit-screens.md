# 0025. Desk review checks the basis, the chemistry and the digits, in code

- Status: Accepted
- Date: 2026-11-01

## Context

A verification fails on the things a plant can get wrong without any one figure looking
wrong. Coal's calorific value is reported on two moisture bases and the two are not
interchangeable. Clinker cannot release less CO2 than the carbonate its oxides came from.
A weighbridge slip that does not add up is not evidence of a delivery. None of these was
checked, and the pack's readers could not even open the spreadsheets most plants send.

Two defects made this worse than a missing feature.

1. The XLSX reader accepted a namespaced `<x:sheet>` tag but still looked for unprefixed
   `<x:c>`. Five of the supplied workbooks opened with the right sheet name and no rows.
   Nothing reported an error; every row-level check simply had no data.
2. Column headers were matched by exact name, so `Clinker Output (t)` and `GCV (kcal/kg)`
   were invisible to readers that wanted `Clinker Production (t)`.

The proposal this responds to also suggested a Python, DuckDB and pint subsystem. This
repository is one TypeScript deployable; a second runtime would mean a second language,
a second set of types and a second test command for arithmetic that is a few lines long.
The arithmetic is done in TypeScript, in the pure `backend/domain/` layer, and tested
directly.

## Decision

**Read the files plants actually send.** The XLSX reader accepts any namespace prefix on
elements and attributes, including inline and shared strings. A regression test now builds
a fully prefixed workbook and asserts the cells, not only the sheet name. Column headers may
be given aliases per reader, each matched with the same unit rules, so a synonym is accepted
and a different quantity is not.

**Normalise the basis before comparing (Process 5.2).** `moistureBasis.ts` converts a
calorific value between as-received, air-dried and dry bases using the standard moisture
relation, and computes the CO2/CaO and CO2/MgO constants from atomic masses. A conversion
that cannot be made states why and the check reports "not applicable"; nothing is assumed.
The new `gcv_basis_nabl` check compares the certificate with the internal log only after
both are on one basis, and fails when the two moisture figures describe different coal.

**Give the chemistry a floor (Process 5.7).** `calcinationChemistry.ts` computes the
stoichiometric calcination floor from CaO and MgO. `calcination_stoich` fails a declared
factor that is below it by more than a 2% analytical tolerance. The constants are derived,
not copied, and the difference from the published rounded constants (0.03%) is recorded.

**Judge a document on its own numbers (Processes 3.0 and 4.3).** `documentConsistency.ts`
checks that gross minus tare equals the net a weighbridge slip prints, and that a four-part
proximate analysis closes to 100%. Each check has a stated band.

**Screen typed quantities for digit patterns (Process 13.3).** `digitScreen.ts` runs a
terminal-digit uniformity test and, where the data allows it, Benford's first-digit test.
Benford is declined with a reason on a set that spans less than one order of magnitude,
because a GCV series clustered between 4,117 and 4,275 kcal/kg has no first-digit
distribution and would otherwise be reported as a strong deviation. A screen never blocks.

**A missing reading is not a block.** These checks use `optional()` in the rule set: a pack
without a clinker analysis or a weighbridge slip reports "not applicable" instead of
pending. Pending means someone is expected to enter the figure; optional means the evidence
may not exist.

## Consequences

- The desk review now reports two new readings it can obtain on its own from an ordinary lab
  file and an ordinary certificate: the NABL basis and the per-sample moisture.
- The five workbooks that were silently empty now carry rows, which changes what the existing
  checks see. On the fixture this turned up petcoke at 208.38 t in the log and the coal sample
  count of 30.
- The moisture agreement band (0.5 percentage points) and the 2% oxide tolerance are product
  defaults, not figures from the procedure. They are stated in each check's threshold text and
  are open items in the register.
- The digit screen is statistical. A small set is never judged, a narrow set is never
  Benford-tested, and a flag asks for the originals rather than asserting a figure is false.
- The CO2/CaO and CO2/MgO constants are chemistry, not a notified emission factor. Whether a
  scheme requires the floor test, and what tolerance it allows, stays with a domain reviewer.
- A PDF-heavy test that builds a document and loads pdf.js now has an explicit 20-second
  budget. It was being failed by load, not by a wrong answer.
