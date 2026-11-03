# 0016. Audited bulk accept of low-risk values, behind a reviewed sample

- Status: Accepted
- Date: 2026-10-09

## Context

A real engagement produces hundreds of extracted values, most of them unremarkable. Reviewing
every one with equal care is where verifier time goes, and it is also where attention fades. The
alternatives were no shortcut (slow), or accepting everything above a confidence score (a model's
confidence deciding what a person never sees).

## Decision

A value is eligible for bulk accept only if it is read from a document page, is not material to
the result, was extracted with confidence at or above 0.9, is marked for auto-commit by the pack,
and does not contradict a value the entity declared (`backend/domain/triage/risk.ts`).

Bulk accept is blocked until a deterministic sample of the eligible values has been reviewed one
by one and every one was accepted unchanged. The sample is chosen by hashing the engagement and
field, so it is the same on every load and cannot be re-rolled. The sample rate comes from the
latest approved verification plan ([0017](0017-verification-plans-are-versioned.md)), else 0.2,
with a minimum of three. The server recomputes eligibility and the sample on every request and
refuses if the client's expected count differs.

Each bulk action writes an append-only `bulk_accept_batches` row and an audit event. Facts and
proposals record how they were accepted (`accept_mode`, `bulk_batch_id`), and reports and the
submission package disclose the bulk share.

## Consequences

- The shortcut is limited to values a person has already spot-checked and that do not matter to
  the answer. A model's confidence never decides alone.
- The sample rates (0.1, 0.2, 0.4 by plan risk) and the 0.9 threshold are product controls, not
  regulatory values. They are listed in the regulatory register as internal.
- A firm that wants no shortcut sets nothing and uses the one-by-one workbench as before.
