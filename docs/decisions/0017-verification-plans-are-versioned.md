# 0017. Verification plans are immutable and versioned

- Status: Accepted
- Date: 2026-10-09

## Context

A verifier decides, before looking at evidence, how risky each part of the engagement is and how
much to sample. If that plan can be edited in place, it can be adjusted after the fact to fit
what was found, which defeats the point of having one.

## Decision

A plan is a row in `verification_plans`, which is append-only. Saving creates a new draft
version. Approving creates a further row with status `approved` and the same content hash.
Nothing is updated. The overall risk is the highest of the factor ratings, and the sampling rate
follows from it (`backend/domain/planning/plan.ts`). Only the latest approved version is used by
triage.

Approval needs every standard factor rated, and a plan for the site visit if the assessment calls
for one. A verifier may override the sampling rate, but only with a written reason, and the
override is recorded as such. Some factors are derived from the data (the share of bulk-accepted
values, the comparison with declared values) rather than rated by hand.

## Consequences

- The history of what the verifier planned, and when, is intact and hashable.
- Changing a plan mid-engagement is allowed and visible: it is a new version after the fact.
- The default rates are policy, not regulation, and are listed as internal in the register.
