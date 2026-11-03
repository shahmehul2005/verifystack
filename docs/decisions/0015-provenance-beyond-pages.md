# 0015. Provenance covers more than document pages

- Status: Accepted. Extends [0004](0004-no-fact-without-provenance.md).
- Date: 2026-10-09

## Context

[0004](0004-no-fact-without-provenance.md) says no fact exists without a pointer to where it came
from, and the pointer was a document, a page and a region. Real evidence is also a cell in a
spreadsheet, a range of a SCADA export, or something a verifier saw on site and no document shows.
Forcing those into a page pointer would either invent a page or drop the rule.

## Decision

A fact carries one of four provenance types: `document_page`, `spreadsheet_cell`,
`time_series_range`, `site_observation` (`backend/domain/provenance.ts`, migration `0013`).
Page evidence keeps its original columns, so nothing written before this change is migrated.
The other three store a structured `provenance` object. The rule is unchanged: a fact without
one of the four does not insert.

For spreadsheet cells and time-series ranges the server re-reads the stored file and takes the
value itself. A value sent by the browser is never trusted. A site observation has no document
and is accepted only by someone other than the person who recorded it ([0021](0021-fieldwork-observer-is-not-accepter.md)).

## Consequences

- Every accepted value can say where it came from, in words, whatever the source.
- Reports and the review queue must render all four types. They go through `describeProvenance`
  so there is one wording.
- A new evidence type is a new provenance type with its own validation, not a loophole.
