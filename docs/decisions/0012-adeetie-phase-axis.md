# 0012. ADEETIE phases as a second axis

- Status: Accepted
- Date: 2026-09-02

## Context

An ADEETIE engagement is three pieces of work — IGEA, DPR and M&V — each needing its own
evidence, review, calculation, findings and sign-off, with a money gate before M&V. CCTS has one
pass. Adding phase-specific statuses would make the status machine scheme-specific.

## Decision

The engagement status machine (`setup → … → submitted`) describes one pass and is the same for
both schemes. ADEETIE adds a phase axis (`IGEA → DPR → MV`, `packs/adeetie/phases.ts`). A phase
advances only when its pass is `submitted`, and the status resets to `setup` for the next phase.
IGEA and DPR may only write a `baseline` SEC run; M&V may only write `post_implementation`. M&V
never consumes baseline-phase documents (`domain/adeetie/lifecycle.ts`).

## Consequences

- CCTS behaviour is untouched by ADEETIE.
- The baseline is effectively locked once IGEA closes.
- Changing an engagement's baseline year after evidence exists does not rewrite facts; the year
  is set at creation and is not editable in the app.
