# 0021. Fieldwork: the observer is not the accepter, and capture works offline

- Status: Accepted
- Date: 2026-10-09

## Context

What a verifier sees on site has no document to cite. If the person who recorded an observation
could also accept it as a fact, a single person would create and approve evidence without a
second look.

## Decision

An observation is recorded against a scheduled site visit and becomes a proposal, not a fact. A
different person must accept it in the workbench; the server compares the proposer with the
session user and refuses a match (`assertAccepterIndependent`, enforced in `/api/facts`).

Captured observations carry a client-generated id, and the server treats a repeat of the same id
as the same observation, so a flaky connection or a retried sync creates no duplicates. A queue in
the browser holds observations while offline and sends them in order when the connection returns
(`backend/domain/fieldwork/queue.ts`). Photos upload only when online, are stored as evidence with
`source = 'fieldwork'`, and are not sent to extraction.

## Consequences

- Site evidence gets the same two-person discipline as everything else.
- A small team has to have a second person to accept. A one-person engagement cannot accept its own
  site observations; that is intended.
- Whether verifiers need offline capture at all is unconfirmed. It stays because the queue is small
  and idempotent, and is listed in the open questions for user validation.
