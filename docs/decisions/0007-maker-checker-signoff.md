# 0007. Structural maker–checker sign-off

- Status: Accepted
- Date: 2026-09-02

## Context

Verification statements are credible because a second, independent person reviews them.
Enforcing that by convention fails as soon as a firm is busy.

## Decision

Sign-off requires two signatures from two roles. `signoff.lead` belongs only to
`lead_verifier`; `signoff.reviewer` belongs only to `independent_reviewer`; no role has both
(`backend/lib/auth/capabilities.ts`). `assertMakerChecker` also rejects a reviewer signature
from the user who signed as lead, and `assertCanSignOff` rejects sign-off while any `block`
finding is open (`backend/domain/signoff/guards.ts`).

## Consequences

- A one-person firm cannot complete an engagement in VerifyStack.
- The firm admin role has no verification powers, so it cannot be used to bypass the split.
- `capabilities.test.ts` pins each role's sign-off powers, so a change to the split fails CI.
