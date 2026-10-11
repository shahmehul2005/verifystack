# 0009. Citations by retrieval with a groundedness gate

- Status: Accepted
- Date: 2026-09-05

## Context

A finding is stronger with the clause it rests on. A model asked to recall a regulation will
produce a plausible clause that may not exist. A prompt instruction not to invent clauses is not
a control.

## Decision

Regulatory text is stored verbatim in Postgres with pgvector (migration `0010`), chunked on
clause boundaries. For each finding the system filters chunks by scheme and sector first, then
ranks by similarity, and gives the model only the retrieved chunks. `groundedness.ts` checks that
every cited clause is one of those chunks; otherwise the citation is rejected. The outcome is
recorded as `grounded`, `rejected`, `no_applicable_clause` or `unavailable`, and a human accepts,
edits or rejects it. A missing API key fails loudly rather than using a zero vector.

pgvector was chosen over a separate vector database because Postgres is already the system of
record and the corpus is small.

## Consequences

- A clause the model invents cannot reach the reviewer.
- Citations are only as good as the ingested corpus; today it is synthetic.
- The retrieval threshold (0.28) needs tuning against labelled pairs.
- Changing the embedding model or dimension needs a new migration and a full re-ingest.
