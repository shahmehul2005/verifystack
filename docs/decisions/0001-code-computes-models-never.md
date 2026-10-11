# 0001. Code computes; models never do

- Status: Accepted
- Date: 2026-08-22

## Context

A verifier signs a GEI or SEC figure and carries liability for it. Language models produce
fluent arithmetic that is sometimes wrong and cannot be reproduced. A number that came from a
model cannot be defended to a regulator, a credit buyer or a lender.

## Decision

All calculation is done in pure, deterministic, versioned code (`backend/domain/calc/`). Models
are limited to classifying documents, proposing extracted values with provenance, explaining
retrieved clauses and rewording CAR or ECM text. No model output is used as a number in a result,
a factor, or a threshold.

## Consequences

- Results are reproducible from the inputs and the engine version alone.
- Golden tests can pin engine output exactly.
- Every new metric needs engineering work; a model cannot "just work it out".
- Prompts never need to be trusted for correctness, only for usefulness.
