# Architecture decision records

Each file records one significant decision: the context, what was decided, and what it costs.
Decisions are not edited after they are accepted. To change one, add a new record that
supersedes it and update the status line of the old one.

| #    | Decision                                                                 | Status   |
| ---- | ------------------------------------------------------------------------ | -------- |
| 0001 | [Code computes; models never do](0001-code-computes-models-never.md)     | Accepted |
| 0002 | [One application in two workspaces](0002-one-app-two-workspaces.md)      | Accepted |
| 0003 | [Methodology packs are data](0003-methodology-packs-are-data.md)         | Accepted |
| 0004 | [No fact without provenance](0004-no-fact-without-provenance.md)         | Accepted |
| 0005 | [Run with unverified factors, flagged](0005-unverified-factors-flagged.md) | Accepted |
| 0006 | [The platform owns reference factors](0006-platform-owns-reference-factors.md) | Accepted |
| 0007 | [Structural maker–checker sign-off](0007-maker-checker-signoff.md)       | Accepted |
| 0008 | [Tenant isolation in the database and in every route](0008-tenant-isolation.md) | Accepted |
| 0009 | [Citations by retrieval with a groundedness gate](0009-citations-retrieval-groundedness.md) | Accepted |
| 0010 | [Deterministic ECM matching](0010-deterministic-ecm-matching.md)         | Accepted |
| 0011 | [Signed invite tokens](0011-signed-invite-tokens.md)                     | Accepted |
| 0012 | [ADEETIE phases as a second axis](0012-adeetie-phase-axis.md)            | Accepted |
| 0013 | [Eligibility exceptions are reviewed, not computed](0013-eligibility-exceptions-reviewed.md) | Accepted |
| 0014 | [Content-addressed private evidence storage](0014-content-addressed-evidence.md) | Accepted |
| 0015 | [Provenance covers more than document pages](0015-provenance-beyond-pages.md) | Accepted |
| 0016 | [Audited bulk accept of low-risk values, behind a reviewed sample](0016-audited-bulk-accept.md) | Accepted |
| 0017 | [Verification plans are immutable and versioned](0017-verification-plans-are-versioned.md) | Accepted |
| 0018 | [Issue lifecycle and signed entity response links](0018-issue-lifecycle-and-entity-response-links.md) | Accepted |
| 0019 | [Independent technical review is bound to a snapshot](0019-independent-technical-review.md) | Accepted |
| 0020 | [Generic submission package, built on demand](0020-generic-submission-package.md) | Accepted |
| 0021 | [Fieldwork: observer is not accepter; offline capture](0021-fieldwork-observer-is-not-accepter.md) | Accepted |
| 0022 | [Evidence packages: manifest optional, mismatches flagged; spreadsheet totals approved by a person](0022-optional-manifest-and-reviewed-totals.md) | Accepted |
| 0023 | [Documents can be removed only while nothing accepted rests on them](0023-guarded-document-removal.md) | Proposed |
| 0024 | [The website assistant screens, scopes and grounds every answer](0024-website-assistant-guardrails.md) | Accepted |

## Template

```markdown
# NNNN. Title

- Status: Proposed | Accepted | Superseded by NNNN
- Date: YYYY-MM-DD

## Context
What forces the decision. Facts, not opinions.

## Decision
What we do.

## Consequences
What gets easier, what gets harder, what we must watch.
```
