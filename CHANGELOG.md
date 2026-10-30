# Changelog

Notable changes to VerifyStack. The format follows [Keep a Changelog](https://keepachangelog.com/).

Calculation runs record their engine and pack versions, so any change that can alter a result
must say which version it bumps. Current versions:

| Component                     | Version                           | Defined in                              |
| ----------------------------- | --------------------------------- | --------------------------------------- |
| GEI engine (`ENGINE_VERSION`) | 0.1.0                             | `backend/domain/calc/engine.ts`         |
| SEC engine (`SEC_ENGINE_VERSION`) | 0.1.0                         | `backend/domain/calc/sec.ts`            |
| CCTS packs (9 sectors)        | 1.0.0                             | `backend/domain/packs/ccts/`            |
| ADEETIE packs (14 sectors)    | 1.0.0                             | `backend/domain/packs/adeetie/`         |
| Extraction prompt             | `2026-08-31.classify-no-soften`   | `backend/domain/extraction/gemini.ts`   |
| Citation prompt               | `2026-09-05.cite-retrieved-only`  | `backend/domain/citations/types.ts`     |

## [Unreleased]

### Desk review: real PDF reading, period-aware calcination, NABL band, stronger integrity checks

Found by running the Dataset-2 engagement end to end. No engine or pack version changes: the run input and
its hash are unchanged for any year and any supplied figure.

- **Suggestions come from the PDF.** "Suggest from documents" used to return fixed numbers from the Shyamrock
  fixture, so it could never see a fault in the PDFs actually uploaded. It now reads each PDF's text layer
  (`pdfjs-dist`, no model) and applies a labelled-row extractor per reading. A figure is suggested only when its
  row is found; the auditor still accepts or edits it. A PDF with no text layer (a scan) is named as unreadable
  and nothing is guessed. The route needs `review.decide`, takes PDFs up to 25 MB, and names what it skipped.
- **Calcination follows the intensity basis.** Section 3.4(1) Note (p. 7) sets the 2024-27 targets on direct
  energy and indirect emissions and defers process emissions. A cement run no longer returns a 422 for a missing
  calcination figure when the compliance year is FY2024-25 to FY2026-27. A figure the plant does supply is still
  counted, and the run says so in a warning, so no number changes on an interpretation. Outside that window, or
  when the year cannot be read, the figure is required as before. Pack streams gained `basisWindow`.
- **The two calcination methods are alternatives.** A run needs one of them (`requiredGroup`) and refuses both,
  which would count the process CO2 twice. The runs page says what was left out of the basis for the year.
- **NABL band enforced.** `gcv_nabl_corroboration` fails when internal and NABL coal GCV differ by 71.7 kcal/kg
  or more, cited to Clause 4(10)(ii)-(iii), p. 14. It reports the clause remedy and does not apply it.
- **Formula integrity.** The pro forma is checked against the template for the layout it matches, which removes
  false positives on other layouts and catches formulas overwritten with typed values on later sheets.
- **Evidence period.** New `evidence_period` check: a dated series that reaches outside the compliance year
  fails. Data from FY2023-24 now says so against an FY2026-27 engagement.
- **Documents tab.** A file that sits in an evidence slot but has no page type now reads "In slot: …" and not
  "Not classified". The checklist counts the slot, so the two views no longer look contradictory.
- Register: section 9 records the open readings (the "2024-27" window, whether achieved intensity should also
  exclude process emissions, the sign and cadence of the NABL difference, other sectors).

### Documents: suggest a type for every unassigned file, in batches

- **One button.** "Suggest types for all unassigned" on the Documents tab names every PDF, PNG and JPEG that has
  no type yet. It shows progress, waits out a rate limit, and has a Stop button; a stopped run leaves the rest
  for the next one. A type that is already set, by hand or earlier, is never changed, even if someone sets one
  while the model is working.
- **Batches sized to the limits.** One model call carries the first page of up to 8 files and returns a type for
  each, so thirty files take four calls. A call is capped at 9 MB of page data (about 12 MB on the wire, under
  the model's inline cap). The server decides what fits and hands the rest back for the next call, so a browser
  cannot overrun it. A first page over 12 MB, a WebP and spreadsheets are named in the summary and not sent.
- **What is sent.** The first page of each file as data, and the methodology's document types. No filename or other
  metadata. Each call is recorded in `ai_action_logs` (`classify_batch`, with the input hash) and in the audit log
  (`documents.classified_batch`).
- **A suggestion is not a decision.** The type is saved with the model's confidence, shown on the row as before.
  The evidence slot follows only when confidence is 0.9 or more, the same floor extraction uses for review, so
  an unsure suggestion does not mark a checklist slot as filled.
- Calls count against the existing per-user model-call limit (30 a minute). A busy or rate-limited model is retried
  after the wait it names, or 2, 4 and 8 seconds. No migration.

### Desk review: findings, the lead schedule, snips and the binder

- **One clause registry.** The desk review cites each check to the clause in the register (stock balance,
  completeness, sampling, NCV basis, materiality, renewable claims, export deduction). A check with no clause of
  its own is cited to the procedure as a whole and says so; no clause number is invented. The register notes the
  owner's confirmation. See `backend/domain/deskreview/clauses.ts`.
- **Raise a finding in one step, built on the server.** `POST /api/desk-review/raise-finding` takes only the
  engagement and the check. The title, figures, clause, size of the gap, required response and evidence references
  come from the latest saved run and the registry, and a finding already stored for the check is not duplicated.
  Runs and decisions store the same fields. `/api/findings/create`, which trusted browser-supplied text and did
  not check the engagement's organization, is removed.
- **The lead schedule is built by one function.** `buildLeadSchedule` takes the desk-review results and gives
  each line its reported and evidenced figures, the difference, the band, the clause and the decision, and the
  aggregate position against 2% of the reported total. The page and the binder read the same structure. It never
  calls a line material and never says verified. The previous schedule pointed at checks that no longer exist
  (`coal_log_vs_po`, `gcv_rule`) and labelled any pass "within 0.5%".
- **Snip a figure from the page.** Draw a box on the page a typed figure was read from, say what is printed in
  it, and the box is kept with the value (normalised to the page, as extraction does). A snip is human provenance;
  nothing reads the box for the auditor. Migration 0020 adds `bbox`, `source_text` and `source_kind` to
  `desk_readings`.
- **A binder.** `GET /api/desk-review/binder?engagementId=` returns a PDF with the cover and content digest, the
  lead schedule, the aggregate, the findings and decisions, an index of every figure with its file hash and page,
  cell or region, and the cited pages with each snipped region drawn on. The same content gives the same bytes. The
  file's SHA-256 and the digest are written to the audit log (`desk_review.binder_generated`) and returned in
  `X-Binder-SHA256` and `X-Binder-Content-Digest`. The layout is generic.

### A new look for the public site and the shared components

- **Public home page rebuilt.** The hero is a live fragment: press a value on an invoice page, then accept or
  correct it, and it becomes a fact with a name and an identifier. Below it, one engagement pinned beside six
  statements and changing state, an index of five output documents, the principles as a large-type list, schemes,
  a dark trust band, a question index and the demo form on a colour field. All copy and claims are the existing
  ones. The fragments are synthetic and say so.
- **Shared tokens.** `mist` is now a warm stone scale and `teal` a grey-green moss, so every screen takes the
  new palette. The gradient wash, grain, frosted glass, resting shadows, gradient buttons, monospace labels and
  the serif accent are gone. Panels are a tone step with a quiet edge; shadows are kept for menus and dialogs.
  Buttons are one flat fill with a 6px corner (square on the public site). Corner radii are smaller.
- **Auth and legal pages** use the same frame and type. The header, footer and demo form follow.
- **One photograph**, a limestone quarry and cement works (CC BY 2.0, credited in the footer).
- No behaviour, route or data changes. App screens could not be previewed without a Supabase connection.

### Desk review: messy files and checks that prove value

- **Dates and headers.** Workbook dates are read in ISO, day-first (`15/11/2023`, `15-11-2023`), named-month
  (`15-Nov-23`) and Excel serial forms; `31/02` is not a date. The date column is found wherever it sits
  (left-most on a tie), so a serial-number column in A no longer hides it. A header matches ignoring case and
  a unit only when the units agree (`(kg)` is not `(t)`).
- **Nothing is dropped or replaced silently.** Reading notes now say when a row holds a figure but no
  readable date, when a date repeats, when dated rows are empty, and when a later file or sheet replaces a
  different figure from an earlier one. Files are read in a fixed order. A dated row with no value is no
  longer counted as zero output or as a month of evidence.
- **Coverage checks prove value.** Twelve months of evidence now also needs a total that matches the annual
  cell within 0.5%, no month far thinner than the series' typical month, and no evidence beyond the
  period. `DPR vs SCADA` uses the shared daily check.
- **Typed PDF figures need a source.** Saving a figure requires its document and page, and the audit entry
  keeps the replaced or removed value. Figures are marked as typed by an auditor, with the date.
- **Show working.** Each check expands to its inputs (value, unit, document, cell or page, and how it was
  read), found against compared-with, difference and the allowed band. A summary line counts checks,
  notes and typed figures. Working defaults are listed in the regulatory register, section 10, and stay
  unverified. No migration.

### Removing an uploaded document

- **Remove** button on the Documents tab (`documents.upload`), with a confirmation. A file can go while
  nothing accepted rests on it; the server refuses, and says why, when an accepted fact, a reviewed
  extraction, a declared figure or a desk-review reading cites it, when the engagement is at sign-off or
  submitted, or when the file came from the entity's response link or fieldwork. Shared bytes are deleted
  only when no other document uses them. Audit action `document.removed`. See ADR 0023. No migration.

### Desk review: fuel oil stream, evidence trail and decisions

- **Cement pack: fuel oil is a stream.** `furnace-oil` (optional) binds `furnaceOil.quantity` and
  `furnaceOil.calorificValue`, read from the pro forma's GHG sheet, priced with `ef_furnace_oil`
  (IPCC 2006, `verified:false`). The desk review's Form 1, workbook and materiality checks now compare
  against coal plus fuel oil instead of reporting fuel oil as a misstatement. A cement run with fuel-oil
  facts now includes the stream, so its result differs from earlier runs on the same plant.
- **Each check shows where its figures came from.** Every desk-review outcome lists the readings it used
  with value, unit, document and cell or PDF page (`DeskOutcome.sources`), linked to the file. The same
  lines are written to the finding's `evidence_refs` and shown on the Findings page.
- **Materiality and completeness strip** at the top of the page: reported total, 2% threshold, quantified
  misstatement, what the total could not count (calcination, petcoke), and which evidence slots are
  missing or cover fewer than 12 months.
- **Decisions on each check.** Accept with explanation, unresolved immaterial, unresolved material, scope
  limitation (`POST /api/desk-review/resolve`). Material and scope limitation raise the linked finding to
  block, so sign-off waits; accepting with an explanation walks the finding to closed through the
  lifecycle and logs the reason as a verifier response. A check that agrees on re-run is marked resolved
  by code. Migration `0019_desk_resolutions.sql`; apply it before deciding checks.

### Desk review and pro forma inputs

- **Desk review** (new engagement page, `review.decide`). A rule engine over the evidence in its slots.
  Workbook figures (SCADA, CPP, fuel log, coal lab, pro forma) are read by code; PDF figures are typed
  by the auditor against a document and page (`desk_readings`). A rule with a missing figure is pending,
  never passed. Each run is saved with every reading it saw (`desk_reviews`). Migration `0018`.
- **Run inputs from the pro forma only.** The cement pack declares `proforma_inputs` (label, sheet, unit,
  scale). A new formula evaluator recomputes the workbook, so formula cells stored as 0 read correctly.
  "Read inputs" on the pro forma document commits them as facts that point at the cell.
- **Engine.** A fuel with a quantity but no calorific value now blocks the run and throws, instead of being
  dropped silently. Streams with no facts stay optional and are listed as counted as zero.

### Changed: evidence packages and spreadsheet totals (ADR 0022)

- **A manifest is optional.** A ZIP with no usable `manifest.json` imports its PDFs, images, Excel and CSV files
  directly, and hashes each on receipt. A manifest's hash mismatch no longer blocks the import: the file is
  imported, flagged, and written to the audit log (`evidence_pack.hash_mismatch`). Unlisted or unsupported
  entries are reported as skipped. The ZIP error for a plain folder is gone.
- **Totals review.** Each spreadsheet or CSV has a Review totals action. Totals are found on upload, recomputed
  from the stored file, and shown beside the workbook's stored value. The auditor edits the metric, tag, unit
  and value, then approves. Approved totals are committed as decided extractions and facts with spreadsheet-cell
  provenance, plus the label and the period the rows cover. A tag already in the ledger is refused.
- **Totals without a total row.** A table with a header row and numbers but no total row gets its totals
  summed on review, one per additive column, named by the column header. Rate, ratio, percentage, quality and
  identifier columns are not summed. Such a total is recorded with the new provenance type
  `spreadsheet_range`. Migration `0017_spreadsheet_range_provenance.sql` must be applied.
- **Upload** takes several files at once and stores them only. Reading stays a separate step.
- **Restored intake work.** Tracked edits from the evidence checklist, the run gate and the click-to-map
  mapper had been reverted in the working tree and were re-applied: `evidence_slots` on the cement pack,
  `documents.slot`, the checklist panel, the run gate, and the workbook-only run filter (off by default).

### Changed: app navigation feel

- Per-request memoisation of `getSession` / `getEngagement` in Server Components, so shell,
  engagement layout and the page share one auth and engagement read.
- Engagement Overview loads ADEETIE panels, savings and stages in parallel; ECM reuses that
  engagement (and runs when already loaded).
- Mutations soft-refresh with `router.refresh()` instead of a full browser reload.
- Engagement-route loading skeleton; short client-router `staleTimes` for tab switches.
- Proxy skips `auth.getUser()` when no Supabase auth cookie is present (anonymous traffic),
  and also on signed-in app navigations (the single `getUser()` is in `getSession()`).
- Engagement and sidebar nav highlight instantly on click; tab links use `prefetch={false}`.
- Soft refresh after mutations runs inside `useTransition` so buttons stay busy until the
  RSC update lands.
- ECM library load is scoped to the pack sector; same match rules as before.
- Migration `0015_engagement_query_indexes.sql` adds engagement_id indexes on hot tables.
  Auth rules, pack behaviour and user-visible outcomes are unchanged.

### Changed: public site and visual language

- **Landing page** rewritten to cover the whole workflow: planning, four evidence types,
  declared-vs-extracted, sampling and bulk accept, fieldwork, issue lifecycle with entity links,
  technical review, the submission package, portfolio import, savings, trust, and an expanded FAQ.
  CBAM and green hydrogen are shown as "in design", not as products.
- **New pages:** `/terms`, `/security`, `/licenses`; `/privacy` rewritten to match what the product
  does today. The terms have not been reviewed by counsel.
- **Footer** with product, scheme and legal links, a regulator-independence disclaimer and an
  optional contact address (`NEXT_PUBLIC_CONTACT_EMAIL`).
- **Typography and surface.** Instrument Sans, Instrument Serif (display accents) and JetBrains
  Mono replace Geist. Panels, the app shell and the assistant use frosted glass over a quiet
  ambient background. Corner radii are larger. No behaviour changes.

### Added: DFD v3.1
Migrations `0013_provenance_v2.sql` and `0014_dfd_v31.sql` must be applied. No engine version
changes: the GEI and SEC engines and every pack calculation are untouched. `SAVINGS_DPR`
(`savings-dpr-1.0.0`) is a new, separate layer.

- **Provenance v2.** A fact may be sourced from a document page, a spreadsheet cell, a time-series
  range or a site observation. Page evidence keeps its original columns.
- **Intake.** XLSX and CSV uploads (including SCADA time series) are parsed before storing and
  indexed as datasets; cells and ranges are mapped to proposals the server re-reads; an evidence
  pack (`.zip` with a manifest) imports files and declared values; images get a header-based
  quality check.
- **Declared vs extracted.** What the entity declared is compared with what was read, kept apart
  from facts.
- **Sampling-aware triage and audited bulk accept.** Low-risk values can be accepted in bulk only
  after a deterministic review sample is clean. Each batch is recorded; reports disclose the share.
- **Verification planning (13.0).** Risk factors, sampling rate and site-visit decision, saved as
  immutable versions.
- **Fieldwork (14.0).** Site visits and observations with idempotent, offline-capable capture; an
  observation needs someone other than its recorder to accept it.
- **Issue lifecycle (7.0).** Findings are opened with the entity, answered through a signed
  one-time link at `/respond/[token]`, verified and closed. `block` issues cannot skip the response.
- **Technical review (8.4).** The independent reviewer approves or requests changes, bound to a
  snapshot; a stale approval does not count and a request for changes blocks sign-off.
- **Submission package (8.7).** A deterministic ZIP with a hashed manifest. Its layout is generic
  and says so.
- **Bulk import and stage manager (1.0).** Import engagements from CSV or XLSX with a dry run;
  ADEETIE engagements track a stage.
- **Savings and payback.** A `SAVINGS_DPR` layer over the recorded measures, with an optional
  rupee saving per measure.
- **Structure only.** CBAM (`EMBEDDED_EMISSIONS`) and green hydrogen (`H2_INTENSITY`) are
  described but not implemented, and refuse to run.
- ADRs 0015 to 0021; open items recorded in the regulatory register (sections 9 and 10).

### Changed
- Closing a block finding now needs the response path (open, respond, verify, close). Closing a
  block issue directly from the sign-off page was removed; the page links to the findings.
- Sign-off is held when a technical review asked for changes, or is required and missing or stale.
- Repository reorganised: documentation moved to `docs/`; `backend/demo/` renamed
  `backend/fixtures/`; CCTS packs grouped under `packs/ccts/`; `units` and `factors` became
  folders; the citation ingest CLI moved to `backend/scripts/`. No behaviour change.
- New npm scripts: `citations:ingest`, `supabase:probe`, `e2e:firm`, `e2e:flow`.

### Added
- Architecture overview, decision records, glossary, regulatory register, contributing guide,
  security policy and this changelog.
- Frontend redesign: teal-on-white design system (`mist` neutrals), logo and app icon, grouped
  sidebar with user menu, engagement tabs and breadcrumbs, split-screen sign-in with the new-firm
  role picker behind a toggle, and a rebuilt landing page. Presentation only; no calculation,
  capability or data-flow change.
- Landing-page demo request: `POST /api/demo-request` emails `DEMO_REQUEST_TO` through Resend,
  rate limited per IP and per email, with a honeypot field. Nothing is stored.
- Website assistant: a chat launcher at the bottom right of every page, backed by
  `POST /api/assistant`. It answers only from the curated entries in
  `backend/domain/assistant/knowledge.ts`. Questions that match no entry are refused before any
  model call. Gemini only rephrases the matched entries, and its answer is discarded in favour of
  the entry text if it cites anything it was not given or adds a number or link. Works without
  `GEMINI_API_KEY` by showing the entry text. Rate limited per IP, with a per-instance daily
  model budget. Reads no tenant data and stores nothing. Toasts moved up to clear the launcher.

### Removed
- Unused components (draft-mode toggle, seed-demo button, ECM library notice, public workbench
  component) and Next.js template images.

### Security
- Migration `0012_server_only_writes.sql`: signed-in users can read their organisation's rows
  but no longer write any table directly through PostgREST. Runs, sign-offs, facts, factor
  verifications and audit events are append-only by trigger. Audit events record the acting
  user through `append_audit_event_as()`; the old RPC is no longer callable by users.
- Factor verification writes through the server after the steward check.
- An invite no longer resets the password of an existing confirmed account.
- Invite tokens prefer `INVITE_SIGNING_SECRET`; email links use `APP_URL` or the request URL,
  never the `Origin` header.
- First Google sign-in is subject to the signup gate.
- Engagements can no longer be set to `submitted`, or skip a status step, through the status
  endpoint.
- Evidence uploads are typed by content (PDF, PNG, JPEG, WebP only), capped at 50 MB, and
  refused if truncated. The proxy body limit is raised so files over 10 MB are no longer stored
  cut short. Evidence downloads send `nosniff` and a safe `Content-Disposition`.
- Rate limits on signup, invite lookup, invites, firm creation and model-calling routes; length
  caps on request fields; generic error messages in production.
- Security headers on every response and a cross-site check on `/api` writes in `proxy.ts`.

## 2026-09-21

### Changed
- Self-serve signup sends a confirmation email through Resend before the account can sign in.
- Invite email delivery fixed.

## 2026-09-06

### Added
- Invite emails through Resend, and a copy button for invite links on the Team page.

### Removed
- Google sign-up button on the create-account page (Google sign-in remains on login).

## 2026-09-05

### Added
- Regulatory Citation Assistant: pgvector corpus, scheme- and sector-filtered retrieval,
  groundedness gate, accept / edit / reject on findings (migration `0010`).
- ECM suggestions: deterministic matching against `ecm_library`, grounded restyling (migration
  `0011`).
- Signed invite tokens; invitees create their account with a password at `/signup?invite=…`.

### Changed
- Runs proceed with unverified factors and list them as warnings, instead of requiring draft
  mode. New engagements start with draft mode off, and the toggle is no longer shown.
- Firms no longer attest factors; only platform stewards cite or correct them.
- Self-serve signup no longer offers a role choice; it creates a firm admin.

### Removed
- Demo seeding (`/api/engagements/[id]/seed-demo` returns 410) and the public `/workbench` demo
  (now redirects to `/login`).

## 2026-09-02

### Added
- Capability-based access control for the four roles, enforced in nav, pages and routes.
- Platform steward role for reference factors (`VERIFYSTACK_STEWARD_EMAILS`).
- Team page with invites and role changes.
- Self-serve signup policy, Google sign-in, password recovery and update.
- ADEETIE Foundry sector and cluster distance (migration `0009`).

## 2026-08-31

### Added
- Verifier application as a `backend/` + `frontend/` workspace monorepo: engagements, hashed
  evidence intake, Gemini extraction with provenance, review workbench, hash-chained runs,
  findings, maker–checker sign-off, PDF reports, Supabase schema and RLS (migrations
  `0001`–`0008`), CI.
- ADEETIE: SEC engine, clusters, and the IGEA → DPR → M&V lifecycle with measures.

## 2026-08-22

### Added
- Deterministic verification core: units, factor catalogue, GEI engine, reconciliation rules,
  extraction scaffolding.
