# 0023. Documents can be removed only while nothing accepted rests on them

- Status: Proposed
- Date: 2026-10-29

## Context

A verifier sometimes uploads the wrong file. Evidence is also what a sign-off attests to: an
accepted fact points at a page and a box (ADR 0004), a reviewed extraction is a decision a person
made, and declared figures and desk-review readings cite their source document. Bytes are stored
once per hash and shared by every engagement that uploaded the same file (ADR 0014).

## Decision

`DELETE /api/documents/[id]` (capability `documents.upload`) removes a document when
`assessRemoval` (`backend/domain/intake/removal.ts`) allows it. It refuses when:

- the engagement is at sign-off or submitted;
- the file came from the entity's response link or from fieldwork;
- an accepted fact, a reviewed extracted field (accepted, rejected or corrected), a declared figure
  or a desk-review reading cites it.

Unreviewed suggestions, pages, extraction jobs and dataset rows go with the document through the
existing cascades. The stored bytes are deleted only when no document row in any engagement still
uses that hash. Every removal is audit-logged (`document.removed`) with the file name, hash, source
and slot. The refusal lists every reason, so the verifier knows what to clear first.

## Consequences

- A wrong upload can be taken back before review work starts, with a record that it happened.
- Once facts are accepted from a document it stays. To drop it, the facts have to be dealt with
  first, which keeps the ledger honest.
- Uploading the same bytes after a removal works again: the per-engagement uniqueness is on the row.
- A narrow race remains: an upload of the same bytes in another engagement that lands between the
  reference check and the byte deletion would point at a missing object. Uploads write the bytes
  before the row, so this needs two uploads of one file at the same moment. If it ever matters,
  keep the bytes and sweep orphans later.
- `documents.upload` is reused rather than adding a capability. Firm admins and independent
  reviewers still cannot remove evidence.
