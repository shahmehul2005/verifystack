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
