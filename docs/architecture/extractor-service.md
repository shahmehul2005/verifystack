# Extractor service

The extractor service reads documents and turns them into proposed values. It is a Python
FastAPI application in `services/extractor/`, and it runs as a **separate process** from the
Next.js app. The decision is recorded in
[ADR 0026](../decisions/0026-python-extractor-service.md). The system overview is in
[`overview.md`](overview.md).

[`overview.md`](overview.md) and `AGENTS.md` say there is no HTTP hop between `frontend/` and
`backend/`. That still holds for those two workspaces. The extractor service is the one HTTP
hop in the system, and it is called only from server-side code.

## 1. What it does

| Job                         | Input                                         | Output                                                    |
| --------------------------- | --------------------------------------------- | --------------------------------------------------------- |
| Classify a page             | One page image or one-page PDF                | A document type from the allowed list, with confidence    |
| Extract fields              | One page and a field catalogue                | Values with page, bounding box and source text            |
| Fill the calendar           | XLSX, XLS, CSV or PDF, plus a compliance year | One reading per stream and period, with its source cell or page |
| Write the calendar template | A compliance year                             | An XLSX the plant fills in                                |

Code computes and models never do ([ADR 0001](../decisions/0001-code-computes-models-never.md)).
Two model roles sit inside a deterministic pipeline:

- **Reader.** Reads PDF pages and returns the numbers it sees. Code then finds each number in
  the page's text layer. A number that is not found is retried, then returned unverified and
  flagged.
- **Mapper.** Maps only the labels the rules could not place to a stream key. It returns keys,
  never numbers. Its output is capped at confidence 0.7 and always needs review.

Spreadsheets are read by code. A workbook whose labels are all matched by rules works with no
Gemini key. A model is called only for leftover labels.

## 2. Shape

```
  frontend/app/api/*  ──▶ backend/lib/extractor/client.ts ──HTTP──▶ services/extractor/api.py
  (route handlers)        (Zod-validated, X-Extractor-Key)            │
                                                                      ▼
                                                  pipeline.py ─▶ workbook · proforma · tabular
                                                       │         pdf_text · locate · streams
                                                       ▼         units · dates (all in code)
                                                  agents.py ─▶ Gemini (Reader, Mapper, classifier)
```

| Module           | Role                                                                                      |
| ---------------- | ----------------------------------------------------------------------------------------- |
| `api.py`         | FastAPI app, key check, size caps, error envelope, CORS allow-list                        |
| `pipeline.py`    | Calendar flows for spreadsheets and PDFs, `extract_fields`, `classify`, flags, run block |
| `workbook.py`    | Format detection, loaders, formula evaluator, template writer                             |
| `proforma.py`    | Pro forma parser. Finds values by label, not by cell address                              |
| `tabular.py`     | Table parser for `long`, `periods_in_columns` and `periods_in_rows` layouts               |
| `streams.py`     | Rules mapper: label to stream key by word-boundary phrases                                |
| `units.py`, `dates.py` | Number, unit and fiscal-year parsing and exact `Decimal` conversion                 |
| `pdf_text.py`, `locate.py` | PDF text with boxes, chunking, exact number lookup                              |
| `agents.py`      | pydantic-ai agents, validators, model provider, failure classification                    |
| `factors.py`     | Unchanged by this work                                                                    |

The TypeScript side is `backend/lib/extractor/client.ts` (HTTP client),
`backend/domain/extraction/extractorServiceProvider.ts` (implements the extraction provider
interface) and the route handlers listed in section 4.

## 3. Run it locally

From the repo root, in PowerShell:

```powershell
pip install -r services/requirements.txt
$env:EXTRACTOR_API_KEY = "a-long-random-string"
$env:GEMINI_API_KEY = "your-gemini-key"
uvicorn services.extractor.api:app --port 8001
# or: python -m services.extractor.cli serve --port 8001
```

Then set `EXTRACTOR_URL=http://127.0.0.1:8001` and the same `EXTRACTOR_API_KEY` in `.env.local`
for the web app. Check the service with `curl.exe http://127.0.0.1:8001/health`.

Tests need the dev requirements and make no network or model call:

```powershell
pip install -r services/requirements-dev.txt
python -m pytest services
```

The Shyamrock fixture tests are skipped with a stated reason when
`do-res/shyamrock_cement_works.zip` is absent.

`npm run typecheck`, `npm test` and `npm run lint` do not run the Python tests. CI does not
run them yet.

CLI commands: `serve [--host] [--port]`, `extract FILE [--year] [--source] [--layout]` and
`template OUT [--year]`. `extract` prints only the API JSON.

## 4. Endpoints

All `/v1/*` endpoints require the `X-Extractor-Key` header. `POST` bodies are
`multipart/form-data`.

| Endpoint                          | Form fields                                                       | Success body                                                     |
| --------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------- |
| `GET /health`                     | none, no key                                                      | `{status, service, version, gemini_configured, provider, model, model_configured}` |
| `GET /v1/template?year=FY2025-26` | query only                                                        | `.xlsx` bytes, `Content-Disposition: attachment`                 |
| `POST /v1/classify`               | `file`, `allowed_doc_types` (JSON), `page_number`                 | `{ok, classification, run}`                                      |
| `POST /v1/classify-batch`         | `files` (repeated), `allowed_doc_types`                           | `{ok, items, run}`                                               |
| `POST /v1/extract-fields`         | `file`, `doc_type`, `page_number`, `catalogue` (JSON)             | `{ok, fields, warnings, run}`                                    |
| `POST /v1/extract-calendar`       | `file`, `compliance_year`, `source_type`, `layout`                | `{ok, file, readings, skipped, unmapped, warnings, run}`         |

`/health` reports the selected `provider`, the resolved `model`, and whether a key is set for
the selected provider (`model_configured`), never the key. `gemini_configured` is kept for
older callers. The web app's schema treats `provider` and `model_configured` as optional, so
an older service still parses.

Errors use one envelope with a `code`:

| Status | `code`                                                         | When                                             |
| ------ | -------------------------------------------------------------- | ------------------------------------------------ |
| 400    | `bad_request`                                                  | Missing field, bad JSON, batch above the limit   |
| 401    | `unauthorized`                                                 | Key missing or wrong                             |
| 413    | `file_too_large`, `page_cap_exceeded`                          | Over the size cap or page cap                    |
| 415    | `unsupported_format`                                           | Format not recognised                            |
| 422    | `corrupt_file`, `password_protected`, `layout_not_recognized`  | File unreadable, or no table or pro forma found  |
| 502    | `model_failure`                                                | A model call failed. No partial readings.        |
| 503    | `extractor_key_missing`, `gemini_key_missing`                  | The named setting is empty, or the provider is unknown. `gemini_key_missing` covers all three model cases; its message names `GEMINI_API_KEY`, `ANTHROPIC_API_KEY` or `EXTRACTOR_PROVIDER`. |

The web app routes that call the service are `/api/extract`, `/api/documents/[id]/extract`,
`/api/documents/[id]/type`, `/api/documents/classify-batch`, `/api/calendar/excel` and
`/api/calendar/excel/template`. Each returns HTTP 503 when `EXTRACTOR_URL` or
`EXTRACTOR_API_KEY` is empty.

## 5. Settings

The service reads its environment on every call (`services/extractor/config.py`).

| Variable                      | Default             | Meaning                                                    |
| ----------------------------- | ------------------- | ---------------------------------------------------------- |
| `EXTRACTOR_API_KEY`           | none, required      | Shared secret. Empty gives 503 on every `/v1/*` endpoint.  |
| `EXTRACTOR_PROVIDER`          | `gemini`            | `gemini` or `anthropic`. Any other value gives 503 `gemini_key_missing` naming `EXTRACTOR_PROVIDER`. |
| `GEMINI_API_KEY`              | none                | Needed when the provider is `gemini`, for PDFs, classify, extract-fields and unmapped labels. Empty gives 503 `gemini_key_missing`. There is no fallback model. |
| `ANTHROPIC_API_KEY`           | none                | Same use when the provider is `anthropic`. Empty gives 503 `gemini_key_missing` naming `ANTHROPIC_API_KEY`. No fallback to Gemini. |
| `EXTRACTOR_MODEL`             | `gemini-2.5-flash` for `gemini`, `claude-haiku-5-5` for `anthropic` | Model name. Empty uses the default for the selected provider. |
| `EXTRACTOR_MAX_UPLOAD_BYTES`  | 26214400 (25 MB)    | Per-file cap                                               |
| `EXTRACTOR_MAX_PDF_PAGES`     | 100                 | Checked before any page is read                            |
| `EXTRACTOR_CORS_ORIGINS`      | empty               | Comma list. The Next.js server does not need CORS.         |
| `EXTRACTOR_MODEL_TIMEOUT_S`   | 90                  | Per model call                                             |
| `EXTRACTOR_CHUNK_CHARS`       | 12000               | PDF text chunk size. Nothing is cut.                       |
| `EXTRACTOR_MAX_CONCURRENCY`   | 4                   | Parallel Reader calls                                      |
| `EXTRACTOR_MAX_BATCH`         | 25                  | Files per `classify-batch`                                 |

The web app reads `EXTRACTOR_URL` and `EXTRACTOR_API_KEY`. `http://` is accepted only for
loopback hosts, redirects are refused, and the key is never sent to another origin. See
`.env.example`.


**Error messages.** The web app maps each client error kind to a specific message (`backend/domain/extraction/failureMessage.ts`) instead of reporting every failure as schema validation. `EXTRACTOR_MODEL` must match `EXTRACTOR_PROVIDER`: leave it empty, or set `claude-haiku-5-5` for `anthropic`. A mismatch shows up as a `service` failure.

## 6. Guarantees

- Every reading carries its real source: sheet and cell for spreadsheets, page and box for
  PDFs. A spreadsheet reading never has a page.
- A number the model reports is checked against the page text layer by exact `Decimal`
  comparison. Scanned pages are capped at confidence 0.6.
- A unit that is missing is never assumed to be tonnes. The stream standard unit is used and
  the reading is flagged `unit_assumed`.
- Mass to volume conversions are not made, because they need a density. The reading is listed
  under `skipped`.
- Readings land as `suggested` when they come from a document, and need a named reviewer to
  become `accepted`. The roll-up and the committed facts read only accepted or corrected rows.
- Request bodies, headers, prompts and model error text are never logged.

### Flags

A reading is flagged `needs_review` with one or more reasons: `unit_assumed`,
`scanned_page`, `outside_fiscal_year`, `regulatory_value`, `coal_total_mismatch`,
`not_convertible` and others listed in the design. A label that names an emission factor, GWP,
NCV or GCV conversion factor, default value, target, trajectory or threshold is flagged
`regulatory_value`. That list is provisional, see the
[regulatory register](../domain/regulatory-register.md) section 9.

## 7. How the web app stores a result

`ExtractorServiceProvider` implements the same provider interface as the Gemini adapter, so
`runDocument.ts`, the provenance gate and the review flow are unchanged. It records
`provider = "extractor-service"` and takes `model`, `promptVersion` (`extractor-1`) and
`inputHash` from the response `run` block.

**`rawOutput` holds the validated service response, not raw model text.** This differs from the
Gemini provider, where it held the model's own output. The service never returns model text.

Calendar readings are written by `saveCalendarReading`. Migration `0030` adds
`canonical_evidence_values.reading_meta` for the flags and locator.

## 8. The TypeScript workbook readers stay

`parseXlsx`, `parseCsv` and the other readers in `backend/domain/intake/` are **kept**. They
feed the deterministic desk review, the evidence-pack importer and the sheet preview route
(`/api/documents/[id]/sheet`), and they run inside the Next.js process with no network
dependency. The extractor service has its own Python readers for calendar extraction. The two
sets of readers are not shared. A fix to one is not a fix to the other, so any change to cell
reading rules needs both a TypeScript and a Python test. Merging them is a later decision.

## 9. Known limits

- **Form-Sb layout is assumed.** The repository has no copy of the real BEE PAT Form-Sb
  workbook. The pro forma parser finds the Baseline and Assessment columns with header patterns
  held in one constant, and its tests use a two-column workbook generated with openpyxl. The
  first real file may need a pattern change. A real sample is needed.
- The regulatory label list is provisional and unconfirmed.
- Excel dates in the preview grid appear as serial numbers, because the TypeScript reader does
  not read number formats.
- Re-importing a file adds new `suggested` rows. It does not replace earlier ones.
- `gemini.ts` stays in the repository for rollback.
- There is no Python job in `.github/workflows/ci.yml`.

## 10. Desk review pro forma preview

Related fix, not part of the service. The desk review's side-by-side panel used to link a pro
forma workbook to the file route, which downloads any non-evidence type, so the reviewer lost
the screen. The panel now renders a workbook inline as a read-only grid with sheet tabs, a
formula marker and a selected-cell bar, fed by `GET /api/documents/[id]/sheet`. PDFs and images
still use the iframe. A separate Download control uses `/api/documents/[id]/file?download=1`.
The file route still never serves a spreadsheet inline.
