# 0026. Extraction runs in a separate Python service

- Status: Accepted
- Date: 2026-11-14

## Context

The TypeScript Gemini extraction had defects that came from its design, not from one line.

- Labels were matched by substring, so `charcoal` and `after` matched shorter stream names.
- Spreadsheet columns past `Z` were read wrongly.
- An unknown unit defaulted to tonnes.
- PDF text was cut to a fixed length and only three pages were read.
- With no Gemini key, extraction fell back to a test model and returned invented values.
- The Excel calendar route had no authentication, and a dev-session fallback let a request
  through without one.
- Excel readings carried a made-up page of 1 and cell names such as `Col3_Row5`.
- The annual window was hardcoded to 2023-24.

The calendar needs a pipeline that reads a pro forma or a plant log by label, keeps the real
source cell, and verifies PDF numbers against the page text. The model must stay a reader and
a label mapper, never a source of numbers ([0001](0001-code-computes-models-never.md)).

[0002](0002-one-app-two-workspaces.md) chose one TypeScript deployable. That decision was
about the application. This work adds a service with a different dependency set (pdfplumber,
openpyxl, xlrd, pydantic-ai) and its own tests.

## Decision

**A separate process.** The extractor is a FastAPI service in `services/extractor/`, called
over HTTP from server-side code only. It is the one HTTP hop in the system. The frontend and
backend workspaces still import each other directly.

**Two model roles inside a deterministic pipeline.** The Reader reads PDF pages. The Mapper
sees only labels the rules could not place and returns stream keys, never numbers. Code does
every lookup, conversion and flag. Spreadsheets are read by code, so a fully rule-mapped
workbook needs no model.

**Fail loud.** A missing `GEMINI_API_KEY` gives 503, a model failure gives 502 with no
partial readings, and the service holds no fallback model. The web app returns 503 from every
extraction route when `EXTRACTOR_URL` or `EXTRACTOR_API_KEY` is empty.

**Shared secret.** Every `/v1/*` request carries `X-Extractor-Key`, compared in constant time
before any body is read. The client accepts `http://` only for loopback hosts and refuses
redirects.

**Suggested, then accepted.** A reading from a document is saved as `suggested`. Only
`accepted` and `corrected` rows reach roll-ups and committed facts
([0004](0004-no-fact-without-provenance.md)). Flags and locator go into
`canonical_evidence_values.reading_meta` (migration `0030`).

**`rawOutput` holds the validated service response.** The Gemini provider stored the model's
own output there. The service never exposes model text, so `ExtractorServiceProvider` stores
the response after schema validation. `promptVersion` is `extractor-1`.

**Keep the TypeScript workbook readers.** `parseXlsx`, `parseCsv` and the intake readers feed
the desk review, evidence-pack import and the sheet preview. They run without a network call.
Replacing them with the service would add a failure mode to calculation inputs and gain
nothing. They stay, and the cost is two sets of readers to keep in line.

**Keep `gemini.ts`.** Its shared validation helpers move to `validate.ts`. The adapter stays
for a rollback path and is deleted after the new path has run in production.

## Consequences

- Two runtimes to deploy and monitor. The web app and the service must share
  `EXTRACTOR_API_KEY`, and the service needs `GEMINI_API_KEY`. See
  [`../architecture/extractor-service.md`](../architecture/extractor-service.md).
- Python tests run with `python -m pytest services`. CI does not run them yet, and a Python
  job in `.github/workflows/ci.yml` is a follow-up.
- Migration `0030` must be applied before a web app that writes `reading_meta` is deployed.
- `reading_meta` is not covered by the immutability trigger on
  `canonical_evidence_values`, so a service-role write could change flags after acceptance.
  Closing that needs a new migration.
- The regulatory label list (emission factor, GWP, conversion factor, default value, target,
  trajectory, threshold) that sets `regulatory_value` is provisional. It is recorded in the
  [register](../domain/regulatory-register.md) and needs a named reviewer.
- The real BEE PAT Form-Sb workbook is not in the repository. The Baseline and Assessment
  header wording is assumed, and the parser tests use a generated two-column sheet. The first
  real file may need a pattern change.
- Mass to volume conversions are not made. They need a density, which is an engineering value
  to escalate, so such readings are listed as skipped.
- The same release fixes the desk review pro forma preview. The side-by-side panel renders a
  workbook inline as a read-only grid through `GET /api/documents/[id]/sheet`, and a separate
  Download control uses `?download=1` on the file route. The file route still never serves a
  spreadsheet inline.
