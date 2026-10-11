# 0013. Eligibility exceptions are reviewed, not computed

- Status: Accepted
- Date: 2026-09-02

## Context

Some ADEETIE eligibility conditions cannot be decided from data the system holds. The 200 km
cluster provision needs notified cluster boundary geometry; a valid Udyam registration needs a
registry lookup.

## Decision

The system never passes these automatically. `AD-ELG002` matches the cluster name exactly against
the notified list; a claimed distance within 200 km raises a `warn` for a reviewer, and no match
with no claim raises a `block`. `AD-ELG001` checks that a Udyam number is present and well
formed, and the finding text says it was not checked against the registry. A human confirms both
against the certificate and the published list.

## Consequences

- No enterprise is declared eligible on an unproven claim.
- Reviewers carry these checks; the finding text tells them what to confirm.
- Boundary geometry or a registry integration would allow automating them, as a new decision.
