# 0006. The platform owns reference factors

- Status: Accepted (replaces firm-level factor attestation)
- Date: 2026-09-05

## Context

CEA grid factors and IPCC defaults are the same published figures for every customer. Letting
each firm attest or edit them would let a firm mark whatever number suits an engagement as
"verified", and would duplicate the same work across firms.

## Decision

Only a platform steward may cite or correct a factor: a user holding `factors.verify`
(`lead_verifier`) whose email is listed in `VERIFYSTACK_STEWARD_EMAILS`
(`backend/lib/auth/steward.ts`). The Factors page appears only for stewards. Every change is
logged in `factor_verifications` and the audit log with `value_changed` and
`by_platform_steward`. An unset steward list means nobody can change a factor.

## Consequences

- Firms cannot alter reference data to fit a result.
- The platform carries the obligation to keep factors current.
- Verification state is still stored per organisation, so a steward must cite factors in each
  organisation they operate. Making it global is an open item.
