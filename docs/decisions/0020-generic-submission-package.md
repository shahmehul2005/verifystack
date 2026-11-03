# 0020. The submission package is generic, built on demand, and discloses its weak points

- Status: Accepted
- Date: 2026-10-09

## Context

A firm needs one thing to hand over. No scheme or portal template has been supplied, so any layout
we chose would look more official than it is. Storing a built package would let it drift from the
records.

## Decision

The package is a deterministic ZIP built from the records each time it is downloaded
(`backend/domain/submission/package.ts`): accepted facts with provenance, the calculation record,
findings and outcome, sign-offs, an evidence index and the evidence files, and a `manifest.json`
that hashes every part. The manifest is also a valid evidence pack, so the package can be
re-imported. The first line of its README says the layout is generic. Pack-specific formats are
flagged `layoutUnverified`.

It refuses to build, and lists why, if there is no run, the run was in draft mode, a block issue is
open, either signature is missing, or the technical review is missing, stale or asked for changes.
It always states the bulk-accepted share, the technical review status, and any unverified factors
that the run used ([0005](0005-unverified-factors-flagged.md)).

## Consequences

- The package cannot claim more than the records support, and it cannot drift from them.
- Nothing is submitted by VerifyStack. Filing is still a download-and-submit step.
- When a real template exists, it becomes a pack format with its own tests, and the flag is removed.
