# 0019. Independent technical review is bound to a snapshot

- Status: Accepted
- Date: 2026-10-09

## Context

Two-person sign-off ([0007](0007-maker-checker-signoff.md)) proves two people attested. It does not
say the second person read the work before the figures changed under them. A review that survives
later edits is worse than none: it reads as assurance that no longer applies.

## Decision

Technical review is the independent reviewer's job, done earlier and on the record. It is not a new
role or a new signature, and the reviewer still signs separately. (`backend/domain/review/technical.ts`.)

- **Independence.** Anyone who accepted a fact or executed a run in the engagement cannot review it.
- **Freshness.** A review is of a hash of the latest run's input hash and every accepted fact. If
  either changes, the review is stale and does not count.
- **Last word.** If the latest current review asked for changes, sign-off is blocked whether or not
  the pack requires a review.

Whether a scheme requires a review is a pack field, `technical_review_required`, default off. The
loader refuses to switch it on without a cited source. Which schemes require one is an open item
in the regulatory register. Reviews are append-only.

## Consequences

- The sign-off route and the review page share one loader, so they cannot disagree about staleness.
- Re-running a calculation after approval makes the approval stale, by design.
- Until the register item is closed, no pack requires a review, so only a request for changes blocks.
