# 0005. Run with unverified factors, flagged

- Status: Accepted (replaces "refuse unverified factors unless the engagement is in draft mode")
- Date: 2026-09-05

## Context

Every shipped factor is `verified: false` until the platform steward cites it. The original rule
refused any run that used an unverified factor unless the engagement was in draft mode. In
practice every engagement had to be in draft mode to run, so the flag carried no information and
the draft-mode toggle confused clients.

## Decision

The engines still refuse unverified factors by default (`allowUnverifiedFactors` is `false` in
`calc/engine.ts` and `calc/sec.ts`). The application's run paths (`calc/run.ts`,
`calc/secRun.ts`) pass `allowUnverifiedFactors: true`, and every unverified factor used is
written into the run's warnings. New engagements are created with `draft_mode: false` and the UI
has no draft-mode toggle.

## Consequences

- Runs complete, and the run record shows exactly which factors were unverified.
- The safety now depends on the steward citing factors and on reviewers reading run warnings.
- The engine-level refusal remains for any future caller that does not opt in.
- `draft_mode` and the `engagements.draftMode` capability remain in the schema for existing data.
