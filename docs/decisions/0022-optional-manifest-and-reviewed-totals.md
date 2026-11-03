# 0022. Evidence packages: manifest optional, mismatches flagged; spreadsheet totals approved by a person

- Status: Accepted
- Date: 2026-10-28

## Context

Auditors receive evidence as loose folders of PDFs and workbooks. The first ingestion design
required a `manifest.json` with a SHA-256 for every file, and refused the whole archive on any
mismatch. A missing or stale manifest therefore blocked a normal upload.

Separately, pro forma and operational workbooks hold many rows, and the totals an auditor needs
are often a single row at the bottom. Mapping each total cell by hand is slow, and extracting it
automatically would commit numbers nobody checked.

## Decision

1. **A manifest is optional.** A ZIP without a usable `manifest.json` imports each supported file
   (PDF, PNG, JPEG, WebP, XLSX, CSV) directly. A malformed manifest is ignored with a warning shown
   to the auditor, and the files still import.
2. **A manifest's hashes are checked, but a mismatch does not block.** The file is imported, marked
   `mismatch`, its expected and actual hashes are written to the audit log (`evidence_pack.hash_mismatch`),
   and the response lists it. Files listed by the manifest are imported whatever their extension, so
   submission packages still round-trip.
3. **Hashing stays synchronous on upload.** ADR 0014 stores each file under its SHA-256, so the hash
   must exist before the file is written. Hashing a 50 MB file takes milliseconds. Moving it after the
   upload returns would need a second storage key and would lose duplicate detection at write time.
4. **Row- and column-level hashes are not added.** File-level hashes give tamper evidence for the
   bytes an auditor relies on. Row and column checksums would add a maintenance burden without
   changing what gets stored.
5. **Totals are scanned on upload and approved by a person.** The scan finds the header row and each
   total row (labelled Total, Sum or Grand total with numbers, or a SUM / SUBTOTAL(9) formula),
   recomputes each total from the rows above by code, and proposes a tag and unit. The auditor reviews
   each draft. The commit route re-reads the stored file, takes the cell and workbook value from the
   file rather than the browser, and writes a decided extraction plus a fact with spreadsheet-cell
   provenance. The label the auditor gave and the period the rows cover are stored with the fact.
6. **A tag already in the ledger is refused.** A second value for the same tag is not added. A
   correction goes through the existing review route.

## Consequences

- A mismatched file is in the evidence set. The audit log records the mismatch, and the auditor sees
  it when importing. Nothing stops a run because of it. A review step that requires a note on any
  mismatched file is an open question (see below).
- Totals become facts only after a named person approves them, and their provenance points at the
  sheet and cell. A monthly total carries its coverage, so it cannot pass as an annual figure
  without the period showing.
- Where a workbook stored no result for a formula, the recomputed sum is offered and labelled
  `not stored`. The stored value is never silently replaced.
- The commit is not one database transaction. Each fact is written after its extraction. A failure
  part-way leaves the earlier rows committed, and the error says so in the server log.

## Addendum: totals computed when the file has no total row

When a table has a header row and numbers but no total row, the server sums each additive column
(recomputed at review time from the stored file) and offers the sum, named by its header. Rate,
ratio, percentage, quality and identifier columns are not summed, and the review says which ones
were left out and why.

A computed total cannot honestly name a cell, so it has its own provenance type,
`spreadsheet_range`: sheet, column, first and last row, aggregation `sum`, and the row count.
This adds a fifth type to the four in ADR 0015. Migration `0017_spreadsheet_range_provenance.sql`
re-states the provenance checks on `facts` and `extracted_fields` to accept it. The four existing
types keep their rules unchanged.

## Open

- Whether a mismatched file should block a run until a reviewer records a note. Not decided.
- Whether the strict behaviour (refuse on mismatch) should be a per-engagement setting for firms
  that need it. Not built.
- Commit has no transaction. A stored procedure would make it atomic. Not built.
