# 0014. Content-addressed private evidence storage

- Status: Accepted
- Date: 2026-08-31

## Context

Evidence must be provably unchanged since upload, duplicates should be detected, and plant
documents must never be publicly reachable.

## Decision

Each file is hashed with SHA-256 on upload and stored in the private `evidence` bucket under its
hash (`backend/lib/hash.ts`, migration `0001`). The bucket accepts PDF, PNG, JPEG and WebP up to
50 MB and has no client access policies. Uploads go through the server after a membership check.
Reads go through `GET /api/documents/[id]/file`, which checks `documents.view` and the
document's organisation, then streams the bytes with `Cache-Control: private`.

## Consequences

- A document's hash proves its content, and identical files are stored once.
- All file access is server-mediated, so it can be authorised and audited.
- Deleting evidence for one engagement must account for other engagements that share the same
  bytes.
