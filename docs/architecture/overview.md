# Architecture overview

This is the one document to read to understand VerifyStack end to end. It describes what the
system does, how it is built, and where each piece lives. Design rationale is recorded
separately in [`../decisions/`](../decisions/README.md); domain terms are in
[`../domain/glossary.md`](../domain/glossary.md).

## 1. Product

VerifyStack is a verification workbench for two Indian schemes administered by the Bureau of
Energy Efficiency (BEE):

| Scheme  | User                                         | Metric | Unit of work                                    |
| ------- | -------------------------------------------- | ------ | ----------------------------------------------- |
| CCTS    | Accredited Carbon Verification Agency (ACVA) | GEI    | One compliance year per obligated entity        |
| ADEETIE | BEE-empanelled energy auditor                | SEC    | Three passes per MSME: IGEA → DPR → M&V         |

It is sold only to the verifier, never to the audited entity. The verifier signs a statement
that carries professional and statutory liability, so the product's job is to make every number
traceable to evidence and reproducible later. It is not there to make a facility's numbers look
better.

A verifier moves an engagement from raw evidence (bills, fuel invoices, lab certificates,
production logs) to a named, two-person sign-off. Along the way every document is hashed, every
extracted value carries its source location, every calculation is versioned and hash-chained,
and every AI output waits for a human decision.

## 2. Invariants

These hold across the codebase. A change that breaks one needs an ADR, not a workaround.

1. **Code computes, models never do.** Engines are pure and versioned. Models classify, extract,
   retrieve and draft prose. They never produce a number that reaches a result.
2. **No value without provenance.** A fact carries document, page, bounding box and verbatim
   source text, or it is not stored as a fact.
3. **AI proposes, humans decide.** AI output is created as a suggestion and needs an explicit
   accept, edit or reject from a named user.
4. **Reproducible runs.** A run records engine version, pack version and input hash, and is
   hash-chained to the previous run on the engagement.
5. **Fail loud.** Missing keys, unverifiable citations and ungrounded text are rejected and
   surfaced, never replaced with a plausible default.
6. **Grounding is enforced in code.** After every generation, code checks the output against the
   records the model was given and discards it if it does not match.

## 3. System shape

```
                    ┌───────────────────────────────────────────────┐
  Browser  ───────▶ │ frontend/  Next.js App Router                 │
                    │   app/(app) pages · app/api route handlers    │
                    │                │  direct imports (no HTTP)     │
                    │                ▼                               │
                    │ backend/   @verifystack/backend               │
                    │   domain/ (pure) · lib/ (I/O) · inngest/      │
                    └───────┬───────────────┬───────────────┬───────┘
                            │               │               │
                     Supabase          Gemini API        Inngest
              Postgres+pgvector,     extraction,       background
              Auth, Storage          embeddings,       intake and
                                     CAR polish        extraction
```

- One deployable: Vercel builds `frontend/`, which bundles `backend/` from source.
- `backend/domain/` has no I/O and is unit-tested directly. `backend/lib/` holds Supabase
  clients, auth and data access. Route handlers in `frontend/app/api/` compose the two.
- Resend sends invite, signup and landing-page demo-request emails; Sentry captures errors with
  `sendDefaultPii: false`.

## 4. The verification pipeline

Process numbers match the data-flow diagrams in [`data-flow.md`](data-flow.md).

| #  | Process            | What happens                                                                                     | Code                                                        |
| -- | ------------------ | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| P1 | Engagement setup   | Engagement is bound to a methodology pack. A database trigger forbids rebinding later.           | `app/api/engagements`, `domain/packs`                       |
| P2 | Intake             | File is SHA-256 hashed, stored privately under its hash, split into pages.                       | `app/api/documents`, `lib/hash.ts`, `extraction/pages.ts`   |
| P3 | Extraction         | Digital PDFs are parsed deterministically; scans go to Gemini. Output is validated for provenance. | `extraction/digital.ts`, `gemini.ts`, `provenance.ts`, `inngest/` |
| P4 | Review             | A reviewer accepts, corrects or rejects each field. Accepted fields become facts.                | `app/(app)/engagements/[id]/workbench`, `app/api/facts`     |
| P5 | Calculation        | The engine reads facts through pack bindings and writes a hash-chained run.                      | `domain/calc`, `app/api/runs`                               |
| P6 | Findings           | Rules raise `block`, `warn` or `info` findings, with a retrieved citation and a CAR draft.       | `domain/rules`, `domain/citations`, `domain/ai`             |
| P7 | Sign-off           | Lead verifier and a different independent reviewer sign. Open `block` findings prevent it.       | `domain/signoff/guards.ts`, `app/api/signoff`               |

Each engagement walks the status machine `setup → intake → review → calc → findings → signoff →
submitted` one step at a time (`domain/engagements/status.ts`).

### ADEETIE lifecycle

An ADEETIE engagement runs the full pass three times, on a second axis (`packs/adeetie/phases.ts`,
`domain/adeetie/lifecycle.ts`):

| Phase | Produces                                              | SEC run              |
| ----- | ----------------------------------------------------- | -------------------- |
| IGEA  | Baseline SEC, energy balance, identified measures     | `baseline`           |
| DPR   | Measures, projected savings, project cost, loan, subvention | `baseline`     |
| M&V   | Post-implementation SEC and savings against baseline  | `post_implementation`|

A phase can only advance once its pass reaches `submitted`. The baseline is locked at IGEA, and
M&V evidence never silently reuses the baseline documents.

### Extended processes (DFD v3.1)

These sit around the pipeline above. None of them changes how a number is computed.

| #    | Process                    | What happens                                                                                          | Code                                                              |
| ---- | -------------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| 1.0  | Bulk import, stage manager | A CSV or XLSX of engagements is dry-run, then created through the wizard's own function. ADEETIE engagements track a coarse stage. | `app/api/engagements/import`, `domain/engagements/bulkImport.ts`, `domain/stages/` |
| 2.4-2.7 | Intake of non-page evidence | XLSX and CSV (including SCADA time series) are parsed before storing; an evidence pack is imported with its declared values; images get a header-based quality check. Cells and ranges are mapped to proposals. | `lib/data/ingestDocument.ts`, `domain/intake/`, `app/api/documents/*` |
| 4.2  | Declared vs extracted, triage, bulk accept | What the entity declared is compared with what was extracted. Low-risk values may be bulk accepted behind a reviewed sample ([0016](../decisions/0016-audited-bulk-accept.md)). | `domain/compare/`, `domain/triage/`, `lib/data/triage.ts`, `app/api/facts/bulk` |
| 5.0  | Method dispatch            | A pack's method picks the engine: `GEI`, `SEC`, `SAVINGS_DPR`. `EMBEDDED_EMISSIONS` and `H2_INTENSITY` are structure only and refuse to run. | `domain/calc/dispatch.ts`, `domain/savings/dpr.ts`, `domain/packs/structure.ts` |
| 7.0  | Issue lifecycle            | Findings are opened with the entity, answered through a signed one-time link, verified and closed ([0018](../decisions/0018-issue-lifecycle-and-entity-response-links.md)). | `domain/issues/`, `lib/auth/responseLink.ts`, `app/respond/[token]`, `app/api/respond`, `app/api/findings` |
| 8.4  | Technical review           | The independent reviewer approves or requests changes, bound to a snapshot ([0019](../decisions/0019-independent-technical-review.md)). | `domain/review/technical.ts`, `lib/data/technicalReview.ts`, `app/api/technical-review` |
| 8.7  | Submission package         | A deterministic, verifiable ZIP built on demand ([0020](../decisions/0020-generic-submission-package.md)). | `domain/submission/`, `lib/data/submissionPackage.ts`, `app/api/package` |
| 13.0 | Verification planning      | Risk factors, a sampling rate and a site visit decision, saved as immutable versions ([0017](../decisions/0017-verification-plans-are-versioned.md)). | `domain/planning/plan.ts`, `app/api/plan`                          |
| 14.0 | Fieldwork                  | Scheduled visits and observations, captured offline if need be, accepted by someone else ([0021](../decisions/0021-fieldwork-observer-is-not-accepter.md)). | `domain/fieldwork/`, `app/api/fieldwork/*`                         |

Facts can now have four kinds of provenance, not only a page ([0015](../decisions/0015-provenance-beyond-pages.md)).

## 5. Domain modules (`backend/domain/`)

| Module         | Responsibility                                                                                         |
| -------------- | ------------------------------------------------------------------------------------------------------ |
| `units/`       | Quantities and conversion. Every number carries a unit; incompatible dimensions throw.                 |
| `factors/`     | Emission factors (CEA, IPCC) and energy content factors (BEE), each with source, vintage and `verified`. |
| `calc/`        | `engine.ts` (GEI), `sec.ts` (SEC), `run.ts` / `secRun.ts` (bind facts, hash inputs, chain runs).       |
| `rules/`       | CCTS reconciliation rules (`rules.ts`), ADEETIE rules (`adeetie.ts`), context built from facts.        |
| `packs/`       | Methodology packs: `ccts/` (9 sectors), `adeetie/` (14 sectors, scheme parameters, clusters, phases).  |
| `extraction/`  | Document schemas, provider interface, Gemini adapter, digital parse, provenance validation.           |
| `citations/`   | Chunking, embedding, retrieval, groundedness gate, ingestion.                                          |
| `ecm/`         | Equipment tags, intensity gap, deterministic ECM matching, grounded restyling.                        |
| `ai/`          | CAR drafting from a template, optional model polish.                                                   |
| `adeetie/`     | Which evidence and SEC phase each ADEETIE pass may use, and phase exit checks.                        |
| `engagements/` | Status machine on both axes.                                                                           |
| `signoff/`     | Open-block check and maker–checker guard.                                                              |
| `reports/`     | PDF templates: CCTS verification report, ADEETIE IGEA, DPR and M&V reports.                            |
| `esign/`       | Signature provider interface.                                                                          |

### Methodology packs

A pack is a record, not a code path. It declares document taxonomy, field schemas, the
calculation method (`GEI` or `SEC`), factor references, stream and production bindings, the rule
set, and a clause citation for every rule. `packs/loader.ts` validates the registry: a runnable
pack must declare its bindings, and every rule must have a citation. Engines and rules never
branch on sector.

### Calculation

- **GEI** = total emissions (scope 1 fuel and process, scope 2 grid electricity) ÷ equivalent
  product. **SEC** = total energy ÷ production.
- The engine refuses an unverified factor unless the caller passes `allowUnverifiedFactors`. The
  app does pass it, and every use is written into the run's warnings (ADR 0005).
- `ENGINE_VERSION` and `SEC_ENGINE_VERSION` are both `0.1.0`. Golden tests pin known outputs.

### Findings

Severity is `block`, `warn` or `info`. An open `block` stops sign-off and ADEETIE phase advance.
Rule IDs: CCTS `MB001 CV001 CV002 LB001 TS001 EF001 SM001 MT001`; ADEETIE `AD-EB001 AD-TS001
AD-CAL001 AD-SEC001 AD-SAV001 AD-ELG001…005`. Clause references and their verification status
are listed in [`../domain/regulatory-register.md`](../domain/regulatory-register.md).

### Regulatory citations

When a finding is raised, the system filters `regulatory_chunks` by the pack's scheme and sector,
ranks by cosine similarity (`gemini-embedding-001`, 1536 dimensions, threshold 0.28, top 3–5),
and asks the model to explain only the retrieved text. `groundedness.ts` then checks that every
cited clause is one the call received. The result is one of `grounded`, `rejected`,
`no_applicable_clause` or `unavailable`, and a human accepts, edits or rejects it.

### ECM suggestions

`ecm_library` rows are matched deterministically on sector, equipment tags derived from the pack's
stream IDs, and the intensity gap. A model may reword a matched row, but `style.ts` rejects any
wording that adds facts not on the row; the raw row is shown instead. An empty match says "no
matching ECM in library". The table is empty until a reviewed BEE guide is loaded.

## 6. Data model

Migrations are in `backend/supabase/migrations/`, applied in order and never edited.

| Migration | Adds                                                                                                 |
| --------- | ---------------------------------------------------------------------------------------------------- |
| 0001      | Organisations, memberships, packs, engagements, documents, pages, extraction jobs, extracted fields, facts, calculation runs, findings, sign-offs, factor records, audit events, AI action logs; RLS helpers; pack-rebind trigger; private `evidence` bucket |
| 0002      | ADEETIE engagement fields (category, Udyam, loan, cost, rate)                                        |
| 0003      | `sec_runs`                                                                                           |
| 0004      | Factor verification log and state                                                                    |
| 0005      | `adeetie_clusters` reference data                                                                    |
| 0006      | Membership RLS                                                                                       |
| 0007      | Runnable sector packs                                                                                |
| 0008      | ADEETIE lifecycle and `adeetie_measures`                                                             |
| 0009      | Foundry pack, claimed distance to cluster                                                            |
| 0010      | pgvector, `regulatory_documents`, `regulatory_chunks`, `match_regulatory_chunks()`, citation columns on findings |
| 0011      | `ecm_library`                                                                                        |
| 0012      | Read-only RLS for signed-in users; append-only triggers; `append_audit_event_as()`                   |
| 0013      | Provenance v2: four provenance types on proposals and facts, `tabular_datasets`                      |
| 0014      | DFD v3.1: stage events, declared values, bulk-accept batches, issue responses, technical reviews, verification plans, site visits and observations, SAVINGS_DPR runs; document source and finding link; issue lifecycle columns |

Tenant data is scoped by `organization_id` with RLS on `is_org_member()`. Signed-in users can
read their organisation's rows and write nothing directly; every write goes through a route
handler using the service-role client, which bypasses RLS, so the handler filters by the
session's organisation itself (ADR 0008). Reference data (packs, clusters, regulatory corpus,
ECM library) is readable by any signed-in user and writable only by the service role.
`audit_events`, `calculation_runs`, `signoffs`, `facts` and `factor_verifications` are
append-only by trigger. Evidence bytes live in the private `evidence` bucket and are streamed
through `/api/documents/[id]/file` after an organisation check.

## 7. Access control

Four roles. `backend/lib/auth/capabilities.ts` is the single source of truth; nav, pages and API
routes all call `hasCapability`.

| Capability              | firm_admin | lead_verifier | verifier | independent_reviewer |
| ----------------------- | :--------: | :-----------: | :------: | :------------------: |
| Engagements, packs      | ✓          | ✓             | ✓        | ✓                    |
| Review queue            |            | ✓             | ✓        | ✓                    |
| Audit log, team         | ✓          |               |          |                      |
| Create engagement       |            | ✓             |          |                      |
| Upload, extract         |            | ✓             | ✓        |                      |
| Review, findings        |            | ✓             | ✓        | ✓                    |
| View runs               |            | ✓             | ✓        | ✓                    |
| Execute runs            |            | ✓             |          |                      |
| Lead sign-off           |            | ✓             |          |                      |
| Reviewer sign-off       |            |               |          | ✓                    |
| ADEETIE operate         |            | ✓             |          |                      |
| Download reports        | ✓          | ✓             | ✓        | ✓                    |

- **Maker–checker.** No role holds both sign-off capabilities, and the guard also rejects the
  same user signing both sides.
- **Firm admin** runs the firm (team, audit log). It is not a superuser for verification work.
- **Factor register.** Only a platform steward sees `/factors`: a `lead_verifier` whose email is
  in `VERIFYSTACK_STEWARD_EMAILS`. Firms do not attest factors.
- **Capabilities added with DFD v3.1.** `plan.manage` and `fieldwork.record` (lead verifier;
  verifiers also record fieldwork), `review.technical` (independent reviewer), and
  `engagements.stage` and `engagements.import` (lead verifier). The independent reviewer and
  verifier gain no existing capability. The public response page has no capability at all: it is
  reachable only by holding a live link.

## 8. Authentication

Supabase Auth with email and password, Google sign-in on the login page, and password recovery.
`frontend/proxy.ts` refuses cross-site writes to `/api`, refreshes the session and gates app
routes. Auth, invite and model-calling routes are rate limited in memory
(`backend/lib/rateLimit.ts`).

- **Self-serve signup** creates the user through `generateLink` and emails a confirmation link
  through Resend. The user becomes `firm_admin` of a new firm. `AUTH_OPEN_SIGNUP` and
  `AUTH_SIGNUP_ALLOWED_DOMAINS` restrict it.
- **Invites** are HMAC-signed tokens valid for 14 days (`lib/auth/firmInvite.ts`). The link opens
  `/signup?invite=…`; the account is created with the invited role and email. If the email
  already has a confirmed account, the invitee must enter its password; an invite never resets
  one. The first Google sign-in passes the same signup gate as self-serve signup.
- `homePathFor` sends firm admins to `/team` and everyone else to `/engagements`.

## 9. Frontend

| Route group    | Pages                                                                                       |
| -------------- | ------------------------------------------------------------------------------------------- |
| `(marketing)`  | `/`, `/privacy`                                                                             |
| `(auth)`       | `/login`, `/signup`, `/forgot-password`, `/update-password`, `/invite`                      |
| `(app)`        | `/engagements`, `/engagements/new`, `/engagements/import`, `/engagements/[id]` and its `plan`, `documents`, `fieldwork`, `workbench`, `facts`, `runs`, `findings`, `ecm`, `technical-review`, `signoff`, `package`; `/review-queue`, `/packs`, `/packs/[packId]`, `/factors`, `/audit`, `/team`, `/forbidden` |
| `respond`      | `/respond/[token]`: public, no account. The entity answers one issue through a signed one-time link. Not an app path, so the proxy does not require a session; the link and the issue's nonce are the only credential. |
| `api/`         | Route handlers. Bodies are validated with Zod. Model-spending routes require a capability, except the public assistant, which is rate limited and budgeted. |

`/workbench` redirects to `/login`. `/api/demo` returns the synthetic Aravalli pipeline from
`backend/fixtures/`.

### Website assistant

`components/assistant/assistant-widget.tsx` is mounted in the root layout, so it appears on every
page. It posts to the public `/api/assistant`, which reads no tenant data and stores nothing.
Its knowledge is the curated list in `backend/domain/assistant/knowledge.ts`; anything not written
there is something it cannot say. The flow follows the citation pattern:

1. Greetings and thanks get fixed replies.
2. `retrieve.ts` scores entries lexically. If none reaches the threshold, the question is refused
   as out of scope and no model is called.
3. Gemini receives only the matched entries and may answer, or say `not_covered` or
   `out_of_scope`.
4. `answer.ts` checks that every cited entry was retrieved and that the answer adds no number or
   link. If the check fails, the top entry's text is shown as written. The same happens when the
   key is unset or the per-instance model budget (`LIMITS.assistantModelBudget`) is spent.

## 10. External services and failure modes

| Service  | Used for                                | Without it                                                       |
| -------- | --------------------------------------- | ---------------------------------------------------------------- |
| Supabase | Data, auth, evidence storage            | Marketing pages load; the app shows a configuration notice       |
| Gemini   | Extraction, embeddings, CAR polish, assistant wording | Extraction returns 503; citations are `unavailable`; CARs use the template; the assistant shows curated text |
| Inngest  | Background intake and extraction        | Upload still hashes and stores; queued jobs fail with a clear error; the per-document Extract button still runs |
| Resend   | Invite, signup and demo-request emails  | Invite links are still shown in the Team page; the demo form returns 503 |
| Sentry   | Error reporting                         | Disabled                                                         |

## 11. Known limits

- Reference data ships unverified: factors, clause references, scheme thresholds and the cluster
  list. See the [regulatory register](../domain/regulatory-register.md).
- The citation corpus loaded by `npm run citations:ingest` is synthetic. There is no PDF ingest
  tool yet.
- `ecm_library` is empty until a reviewed sheet is loaded.
- Udyam numbers are format-checked, not looked up on the registry. Cluster distance is claimed,
  not computed.
- Factor verification is stored per organisation, not globally.
- CBAM (`EMBEDDED_EMISSIONS`) and green hydrogen (`H2_INTENSITY`) packs are structure only. No
  method is implemented and no engagement can be opened on them.
- Which schemes require a technical review, the DPR financial ratios and thresholds, the CCTS stage
  list, and any scheme's submission template are not sourced. The package layout is generic and the
  savings layer computes payback only. See the register.
- Third-party evidence formats are not imported: only VerifyStack's own evidence-pack format,
  until a real sample exists. The image check reads headers only; it is not an image pre-processor.
- The sampling rates, the bulk-accept thresholds, response link limits and the 14-day response
  default are product policy, not regulation.
- Offline capture is a small browser queue. Whether verifiers need it is unconfirmed.
- Rate limits are per server instance.
