# 0004. No fact without provenance

- Status: Accepted
- Date: 2026-08-22

## Context

The main failure of spreadsheet verification is that a number cannot be traced back to the page
it came from. Extraction by a model makes that worse unless the location is captured at the
moment of extraction.

## Decision

Every extracted field carries document ID, page number, bounding box and verbatim source text
(`backend/domain/extraction/provenance.ts`). Output without provenance is not stored as a field.
A field becomes a fact only after a human accepts or corrects it in the review workbench, and
only facts feed calculations. Model output that drifts from the schema is repaired without
inventing values (`soften.ts`): a missing location becomes a full-page box at low confidence, so
a human still reviews it.

## Consequences

- Any number in a run can be opened at its source page.
- Extraction recall is lower than an unconstrained model would give.
- Fields that cannot be located on the page need manual entry with their own evidence.
