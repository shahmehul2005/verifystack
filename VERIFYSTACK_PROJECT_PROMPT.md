# VerifyStack — Complete Project Context Prompt

> **How to use this document.** Paste this entire file as your first message to a coding agent in
> any IDE. It is written to be the agent's only source of project context. It describes the product,
> the domain, the architecture, the data model, the access-control model, the two most recently
> built features, and the rules the agent must not break. Read it end to end before writing code.
> At the very bottom is a section of **open questions that only the project owner can answer** —
> do not guess at those; ask.

---

## 1. What VerifyStack is

VerifyStack is an **operational verification workbench** for India's BEE-administered
(Bureau of Energy Efficiency) industrial compliance schemes.

It is sold **only to verifiers** — Accredited Carbon Verification Agencies and empanelled energy
auditors. It is **never** sold to the audited entity. This single fact drives most product
decisions: the user is a professional whose signature carries legal liability, so the software's job
is to make their evidence trail defensible, not to make their numbers look good.

Two schemes are supported:

| Scheme | Full name | Who uses it | Core metric |
| --- | --- | --- | --- |
| **CCTS** | Carbon Credit Trading Scheme | Accredited Carbon Verification Agencies | **GEI** — Greenhouse gas Emission Intensity |
| **ADEETIE** | Scheme for Adoption of Energy Efficient Technologies in Industries and Establishments | Empanelled energy auditors | **SEC** — Specific Energy Consumption |

The product replaces a spreadsheet-and-email workflow with a system that hash-chains every
calculation, forces provenance on every extracted number, and produces a named, reproducible
sign-off.

---

## 2. Non-negotiable design invariants

These are the project's constitution. **Every one of them has been violated by a well-meaning
agent at some point. Do not be that agent.** If a task appears to require breaking one of these,
stop and escalate instead.

1. **Code computes, models never do.** The calculation engine is pure, deterministic, and
   versioned. A language model must never perform arithmetic, never derive a factor, and never
   produce a number that flows into a result. Models retrieve and draft prose; that is all.
2. **No value without provenance.** Every extracted field must carry document id, page number,
   bounding box, and verbatim source text. A value that cannot produce those is dropped to the
   audit log rather than persisted as a fact.
3. **AI proposes, humans decide.** Every AI output is created in a `suggested` state and requires
   an explicit human accept / edit / reject. There is no auto-accept path, not even for a demo.
4. **Reproducible forever.** Every calculation run records engine version, pack version, and an
   input hash, and is hash-chained to its predecessor. A run from a year ago must be re-derivable.
5. **Unverified factors are refused.** A run that depends on an unverified emission or energy
   factor fails, unless the engagement is explicitly in draft mode.
6. **Fail loudly, never silently.** Given a choice between rejecting output and surfacing something
   unverifiable, always reject. Missing API keys must produce clear errors, not zero vectors or
   silent fallbacks that look like success.
7. **Groundedness gates are programmatic, not prompt-based.** "The system instruction told the
   model not to hallucinate" is not a control. After every generation, code must verify the output
   against the source records and discard it if it fails.

---

## 3. Domain background the agent needs

### 3.1 CCTS

Nine sectors, all runnable as methodology packs:

`CCTS-ALUMINIUM-v1`, `CCTS-CEMENT-v1`, `CCTS-IRON-AND-STEEL-v1`, `CCTS-CHLOR-ALKALI-v1`,
`CCTS-PULP-AND-PAPER-v1`, `CCTS-FERTILIZER-v1`, `CCTS-PETROCHEMICALS-v1`,
`CCTS-PETROLEUM-REFINING-v1`, `CCTS-TEXTILES-v1`

A CCTS engagement computes **GEI** from emission streams (scope 1 fuel combustion, process
emissions, scope 2 electricity) divided by a production quantity. Packs declare `stream_bindings`
and a `production_binding` that map pack-level stream ids onto facts in the ledger.

### 3.2 ADEETIE

Fourteen Phase-1 sectors, all runnable, including `ADEETIE-FOUNDRY-v1` and `ADEETIE-BRASS-v1`.
An ADEETIE engagement computes **SEC** from energy inputs divided by production, and is structured
as **three sequential phases with a money gate between the second and third**:

| Phase | Meaning | Produces | Exit gate highlights |
| --- | --- | --- | --- |
| **IGEA** | Investment Grade Energy Audit | Baseline SEC, energy balance, identified measures | Baseline year complete with no missing months; energy balance closes within tolerance; no open block findings |
| **DPR** | Detailed Project Report (BEE template) | Proposed measures with projected savings, project cost build-up, loan structure, interest subvention computation | Projected savings ≥ scheme minimum; loan within eligible range; debt share within limit; enterprise category matches claimed subvention rate |
| **M&V** | Post-implementation Monitoring & Verification | Post-implementation SEC, savings % vs baseline | Savings ≥ scheme minimum, achieved **and sustained**; post period comparable to baseline |

Phase transitions are strictly sequential — `canAdvancePhase` permits only `IGEA → DPR → MV`.
The phase machine lives in `backend/domain/packs/adeetie/phases.ts` and is **orthogonal** to the
per-phase verification status machine in `backend/domain/engagements/status.ts`: each phase runs the
full setup → intake → extraction → review → calculation → findings → sign-off cycle.

ADEETIE eligibility rules also consider enterprise category (micro/small/medium), audited
financials, loan sanction from a Registered FI, and proximity to a recognised cluster
(`claimed_distance_to_cluster_km`, with a 200 km proximity check).

### 3.3 Methodology packs are data, not code paths

A pack is a **record** describing sector-specific calculation bindings, reconciliation rules,
extraction hints, and a report template. Adding a sector must never mean adding an `if` branch in
the engine. Packs have a `status` (`runnable` vs. otherwise); a non-runnable pack disables
"start work". Pack validation asserts that a runnable GEI pack declares stream bindings and a
production binding, a runnable SEC pack declares energy bindings plus `sec_config`, and that
**every rule carries a clause citation**.

Packs are also immutable once bound: `engagements_forbid_pack_rebind()` is a database trigger that
prevents swapping an engagement's pack after the fact.

---

## 4. Repo layout and conventions

An **npm workspaces monorepo with exactly two source workspaces.**

| Path | Contents |
| --- | --- |
| `backend/` | `@verifystack/backend` — `domain/`, `lib/`, `inngest/`, `demo/`, `supabase/` (SQL + seed) |
| `frontend/` | The Next.js project root — `app/`, `components/`, `lib/`, `public/`, `proxy.ts` |
| root | workspace `package.json`, shared `tsconfig.json`, `vitest.config.mts`, `eslint.config.mjs`, `.env.example`, CI |

```
backend/domain/
  adeetie/        ADEETIE scheme logic
  ai/             draftCar.ts, polishCar.ts — grounded CAR drafting
  calc/           engine.ts, sec.ts, secRun.ts, run.ts, bindings, golden tests
  citations/      FEATURE 1 — regulatory citation assistant
  ecm/            FEATURE 2 — ECM recommendation module
  engagements/    status machine
  esign/          signature capture
  extraction/     gemini.ts + provenance validation
  packs/          pack registry, loader, ccts/, adeetie/
  reports/        PDF/report templates
  rules/          reconciliation rules, types (Severity = block | warn | info)
  signoff/        named sign-off
backend/lib/
  auth/           getSession, capabilities, requireCapability, steward, signupPolicy, auditEvent
  data/           org-scoped queries (engagements, ecm, ...)
  supabase/       admin/server clients, Database types, updateSession
backend/inngest/  intake + extract background functions
backend/demo/     Aravalli cement seed, adeetieFacts, ingestCitations
```

### 4.1 Import aliases

- Inside `frontend/`: `@/*` → `frontend/*`
- Anywhere: `@verifystack/backend/*` → `backend/*`

Both are declared in the `paths` of `backend/tsconfig.json` and `frontend/tsconfig.json`, and
mirrored in `vitest.config.mts`. **If you add a path alias you must update all three.**

### 4.2 There is no HTTP hop between frontend and backend

The frontend imports backend modules directly as a workspace package; Next bundles them from
source. Do not introduce an internal `fetch` to call your own API when you can import the domain
function. (This was a real bug: `/api/findings` used to HTTP-call `/api/draft-finding`; it now
imports `polishCarDraft` directly.)

### 4.3 `server-only`

These modules begin with `import "server-only"` and **must never be imported from a Client
Component**: `lib/supabase/admin.ts`, `lib/supabase/server.ts`, `lib/auth/*`, `lib/data/*`,
`lib/hash.ts`, `domain/extraction/gemini.ts`, `domain/ai/*`, `domain/citations/embed.ts`.

### 4.4 Next.js version warning

This repo runs a Next.js version with breaking changes relative to most training data. **Read the
relevant guide in `node_modules/next/dist/docs/` before writing App Router code.** Heed deprecation
notices. `next dev` regenerates `frontend/AGENTS.md` and `frontend/CLAUDE.md`; the root `AGENTS.md`
is hand-maintained.

### 4.5 Commands (always run from the repo root)

```bash
npm install
npm run typecheck   # tsc over backend, then frontend
npm test            # vitest, backend + frontend
npm run lint
npm run build
npm run dev
```

---

## 5. Data model

Migrations live in `backend/supabase/migrations/` and are applied in order.

| Migration | Adds |
| --- | --- |
| `0001_init.sql` | `organizations`, `memberships`, `methodology_packs`, `engagements`, `documents`, `document_pages`, `extraction_jobs`, `extracted_fields`, `facts`, `calculation_runs`, `findings`, `signoffs`, `factor_records`, `audit_events`, `ai_action_logs`; `is_org_member()`, `org_role()`, `append_audit_event()`, `engagements_forbid_pack_rebind()` |
| `0002` | ADEETIE engagement fields |
| `0003` | `sec_runs` |
| `0004` | `factor_verifications`, `factor_verification_state` + touch trigger |
| `0005` | `adeetie_clusters` |
| `0006` | memberships RLS |
| `0007` | runnable sector packs |
| `0008` | ADEETIE lifecycle, `adeetie_measures` |
| `0009` | `ADEETIE-FOUNDRY-v1` pack + `claimed_distance_to_cluster_km` on engagements |
| `0010` | **Feature 1** — `pgvector`, `regulatory_documents`, `regulatory_chunks`, `match_regulatory_chunks()` |
| `0011` | **Feature 2** — `ecm_library` |

**Row Level Security is the primary tenancy boundary.** Every org-scoped table has RLS policies
keyed on `is_org_member(organization_id)`. Data access from the app goes through `backend/lib/data/*`
which is org-scoped by construction. The service role key bypasses RLS and is used only for hashed
uploads, signed URLs, and seeding — never for reading user data on a request path.

---

## 6. Roles and access control

Four membership roles. The capability map in `backend/lib/auth/capabilities.ts` is the **single
source of truth**, and nav, pages, and API routes must all call `hasCapability` — never re-derive
permissions inline.

```
firm_admin            firm operations only — team + audit log. NOT a bypass for verification.
lead_verifier         full verification lifecycle + lead sign-off + factor attestation
verifier              intake, extraction, review, runs (view), findings — no sign-off
independent_reviewer  review, findings, and the independent reviewer sign-off
```

### 6.1 Capability matrix

| Capability | firm_admin | lead_verifier | verifier | independent_reviewer |
| --- | :-: | :-: | :-: | :-: |
| `nav.engagements` | ✅ | ✅ | ✅ | ✅ |
| `nav.reviewQueue` | — | ✅ | ✅ | ✅ |
| `nav.packs` | ✅ | ✅ | ✅ | ✅ |
| `nav.factors` | — | ✅ | — | — |
| `nav.audit` | ✅ | — | — | — |
| `nav.team` | ✅ | — | — | — |
| `engagements.create` | — | ✅ | — | — |
| `engagements.draftMode` | — | ✅ | — | — |
| `documents.view` | ✅ | ✅ | ✅ | ✅ |
| `documents.upload` | — | ✅ | ✅ | — |
| `documents.extract` | — | ✅ | ✅ | — |
| `review.decide` | — | ✅ | ✅ | ✅ |
| `runs.view` | — | ✅ | ✅ | ✅ |
| `runs.execute` | — | ✅ | — | — |
| `findings.decide` | — | ✅ | ✅ | ✅ |
| `signoff.lead` | — | ✅ | — | — |
| `signoff.reviewer` | — | — | — | ✅ |
| `reports.download` | ✅ | ✅ | ✅ | ✅ |
| `factors.verify` | — | ✅ | — | — |
| `adeetie.view` | — | ✅ | ✅ | ✅ |
| `adeetie.operate` | — | ✅ | — | — |
| `team.manage` | ✅ | — | — | — |

### 6.2 Maker–checker

Sign-off is deliberately split: `signoff.lead` belongs to `lead_verifier` and `signoff.reviewer`
belongs to `independent_reviewer`, and **no role holds both**. This enforces the maker–checker
principle structurally rather than by convention.

### 6.3 A user with no role sees nothing

`navForRole(null)` returns an empty array. Every page behind a nav link reads org-scoped data, so a
user without a membership gets an empty rail and a bootstrap prompt rather than broken pages.

### 6.4 Two-tier factor stewardship

This is a subtle and important distinction:

- A **platform steward** (the developers, listed in `VERIFYSTACK_STEWARD_EMAILS`) may change a
  catalogue factor's **value**. The published figure is identical for every customer, so changing
  it is a platform action.
- A **firm's `lead_verifier`** may only **attest** the shipped value against a citation — recording
  that they checked the vintage. They cannot replace the number.

Unset `VERIFYSTACK_STEWARD_EMAILS` means nobody can override a value, which is the safe default.
The audit event records both `value_changed` and `by_platform_steward`.
See `backend/lib/auth/steward.ts` and `frontend/app/api/factors/verify/route.ts`.

---

## 7. The verification pipeline (DFD processes)

There is a low-level data flow diagram at `verifystack_low_level_dfd.md`. The processes:

| Process | Meaning | Gating capability |
| --- | --- | --- |
| **P1** | Engagement & pack setup | `engagements.create` |
| **P2** | Document intake (hashed upload) | `documents.upload` |
| **P3** | Extraction trigger (Gemini) | `documents.extract` |
| **P4** | Human review gate | `review.decide` |
| **P5** | Calculation run | `runs.execute` |
| **P6** | Findings (incl. citations, CAR drafting) | `findings.decide` |
| **P7** | Lead / independent sign-off | `signoff.lead` / `signoff.reviewer` |
| **D3** | Pack catalogue | `nav.packs` |
| **D7** | Audit log | `nav.audit` |
| **D8** | Factor register | `nav.factors` / `factors.verify` |

Findings carry `Severity = "block" | "warn" | "info"`. An open **block** finding prevents sign-off
and prevents an ADEETIE phase advance.

---

## 8. Route map

### 8.1 Pages

```
(marketing)/                      public landing
(marketing)/privacy
/workbench                        PUBLIC demo — Aravalli Cement facsimile, works with no keys

(auth)/login  (auth)/signup  (auth)/forgot-password
(auth)/update-password  (auth)/invite

(app)/engagements                 list
(app)/engagements/new             P1 setup
(app)/engagements/[id]            engagement home — phase panel, measures, finance, reports, ECM
(app)/engagements/[id]/documents  P2
(app)/engagements/[id]/workbench  P4 review
(app)/engagements/[id]/facts      facts ledger + synthetic seed button
(app)/engagements/[id]/runs       P5 + run readiness
(app)/engagements/[id]/findings   P6 + citation panel
(app)/engagements/[id]/ecm        FEATURE 2 — ECM suggestions
(app)/engagements/[id]/signoff    P7
(app)/packs  (app)/packs/[packId]
(app)/factors                     D8
(app)/audit                       D7
(app)/team                        firm admin
(app)/forbidden                   capability denial landing
```

### 8.2 API routes

```
/api/auth/signout          /api/auth/signup        /api/bootstrap
/api/demo                  /api/documents          /api/documents/[id]/extract
/api/documents/[id]/file   /api/draft-finding      /api/extract
/api/engagements           /api/engagements/[id]   /api/engagements/[id]/ecm
/api/engagements/[id]/measures                     /api/engagements/[id]/phase
/api/engagements/[id]/seed-demo
/api/factors/verify        /api/facts              /api/findings
/api/inngest               /api/runs               /api/signoff       /api/team
```

**Every route that spends money on a model requires a session with the matching capability.**
`/api/extract` requires `documents.extract`; `/api/draft-finding` requires `findings.decide`. This
was a real vulnerability — both were once unauthenticated, allowing anonymous Gemini spend.

Request bodies are parsed with **Zod**. Route handlers use `NextRequest`/`NextResponse`.

---

## 9. FEATURE 1 — Regulatory Citation Assistant

**Goal.** When a reconciliation rule fires or a calculated value needs justification, retrieve the
*exact applicable regulatory text* rather than letting a model recall it from training data — which
risks a plausible-sounding but wrong citation.

**Retrieval, not recall.** This is the whole point of the feature.

### 9.1 Schema (migration `0010`)

`pgvector` is enabled in Postgres — **no separate vector database**, because Postgres is already
running and new infra is not worth it.

```sql
regulatory_documents(
  id, title, scheme,            -- 'PAT' | 'CCTS' | 'ADEETIE'
  sector_or_cluster,            -- nullable for scheme-general documents
  source_url, effective_date,   -- regulations change; track this
  ingested_at, raw_file_hash    -- detect if the source doc changed since ingestion
)

regulatory_chunks(
  id, document_id, clause_ref,  -- e.g. "Para 4.2(b)" when extractable
  page_number, chunk_text,      -- VERBATIM source text, never paraphrased
  embedding VECTOR(1536)
)
```

Plus the RPC `match_regulatory_chunks()` for filtered similarity search, RLS, and indexes.

### 9.2 Module map (`backend/domain/citations/`)

| File | Responsibility |
| --- | --- |
| `types.ts` | Constants and unions (below) |
| `chunk.ts` | Clause/section-boundary chunking |
| `corpus.ts` | Synthetic corpus for Foundry + Cement |
| `embed.ts` | Gemini embedding helper |
| `mockEmbed.ts` | Deterministic embeddings for tests |
| `rank.ts` | Scheme/sector filter then cosine ranking |
| `retrieve.ts` | DB RPC wrapper |
| `generate.ts` | Drafts the citation explanation |
| `groundedness.ts` | **The validation gate** |
| `attach.ts` | Attaches a citation to a finding |
| `ingest.ts` | Ingestion pipeline |

CLI entrypoint: `backend/demo/ingestCitations.ts`.
UI: `frontend/app/(app)/engagements/[id]/findings/citation-panel.tsx`.

### 9.3 Key constants (`types.ts`)

```ts
EMBEDDING_MODEL          = "gemini-embedding-001"
EMBEDDING_DIM            = 1536
CITATION_TOP_K           = 5
CITATION_TOP_K_MIN       = 3
MIN_RETRIEVAL_COSINE     = 0.28
NO_APPLICABLE_CLAUSE     = "no applicable clause found"
CITATION_PROMPT_VERSION  = "2026-09-05.cite-retrieved-only"

type CitationState = "suggested" | "accepted" | "edited" | "rejected" | "none"
type CitationGate  = "grounded" | "rejected" | "no_applicable_clause" | "unavailable"
```

### 9.4 Flow

1. **Trigger** — a rule fires, or a calculated value deviates enough to need explaining. Hooked
   into findings generation in `/api/runs`, immediately *before* the AI drafts finding language.
2. **Filter first, then search** — filter `regulatory_chunks` by the engagement's `scheme` +
   `sector_or_cluster` (from the bound pack), *then* run vector similarity. Filtering before
   similarity matters enormously because normalization is so sector-specific.
3. **Generate** — pass **only the retrieved chunk text** (with title, clause ref, page) into the
   drafting call, under a system instruction to cite only what is present and to say so explicitly
   when nothing applies.
4. **Validate — non-negotiable** — programmatically confirm every citation string in the output
   actually appears in (or closely matches) one of the chunks that call was given. If the model
   cites anything outside the retrieved set, **reject the output** and route to human review with
   no citation attached, rather than surfacing something unverifiable. This reuses the provenance
   validation pattern from extraction.
5. **Human decision** — the citation lands in `suggested`; the auditor accepts, edits, or rejects
   via `PATCH /api/findings`.

### 9.5 Behaviour when Gemini is unavailable

Unset `GEMINI_API_KEY` **fails loud — never a zero vector**. Findings still insert, with
`citation_gate = "unavailable"`.

### 9.6 UI requirement

The auditor must see, side by side: the retrieved clause's exact text, its source document and
page, and the AI's proposed explanation of why it applies — with accept / edit / reject, matching
the existing findings review interaction.

### 9.7 Tests

- Labeled (rule violation → expected clause) pairs per sector, checked for retrieval recall.
- **Adversarial:** a violation with *no* matching chunk must return "no applicable clause found"
  rather than forcing a citation.
- **Groundedness:** every citation in generated output must text-match a chunk actually retrieved
  for that call.

---

## 10. FEATURE 2 — ECM Recommendation Module

**Goal.** Suggest relevant Energy Conservation Measures for a facility without letting a model
invent an engineering intervention. A fabricated ECM carries real safety and cost consequences,
unlike a fabricated sentence in a findings draft.

**Curated library, not free generation.**

### 10.1 ⚠️ ESCALATION FLAG — read before touching this feature

```ts
// backend/domain/ecm/types.ts
export const ECM_LIBRARY_PRODUCTION_READY = false;
```

`ecm_library` is **not production-seeded**. What ships today is a **synthetic fixture for tests and
demo only**. Those rows are *not* BEE-published measures and must not be used to choose, cost, or
implement an intervention. The UI carries a visible banner saying exactly that
(`frontend/components/ecm/library-notice.tsx`).

**Do not seed this table by asking an LLM to generate ECMs.** Populating it requires a published
BEE sector ECM guide *and* a domain-advisor review. It is a research task, not a scripting task —
it is the single point in the system where a wrong entry could cause real-world harm. Flip the flag
to `true` only after that seeding and review have actually happened.

### 10.2 Schema (migration `0011`)

```sql
ecm_library(
  id, scheme,                   -- nullable; some ECMs are scheme-agnostic
  sector_or_cluster NOT NULL,
  equipment_tag NOT NULL,       -- 'induction_furnace' | 'boiler' | 'compressed_air' | ...
  ecm_name NOT NULL, description NOT NULL,
  typical_savings_range,        -- e.g. "5-12% of related SEC"
  typical_payback_months,
  source_reference NOT NULL,    -- e.g. "BEE Cement Sector ECM Guide, 2023, Sec 3.1"
  source_url
)
```

### 10.3 Module map (`backend/domain/ecm/`)

| File | Responsibility |
| --- | --- |
| `types.ts` | Types + the production-ready flag + escalation banner copy |
| `fixture.ts` | The synthetic library |
| `equipment.ts` | Derives `equipment_tag`s from pack bindings |
| `gap.ts` | Computes the SEC/GEI intensity gap vs. benchmark |
| `match.ts` | **Deterministic** matching and ranking |
| `style.ts` | Optional Gemini styling, groundedness-gated |
| `index.ts` | Re-exports |

Data access: `backend/lib/data/ecm.ts` (org-scoped).
API: `frontend/app/api/engagements/[id]/ecm/route.ts`, gated on `adeetie.view`.
UI: `frontend/app/(app)/engagements/[id]/ecm/page.tsx`, `frontend/components/ecm/suggestions.tsx`.

### 10.4 Matching is deterministic — no LLM in this path

1. From the facility's extracted equipment list and the calculated SEC/GEI gap versus the sector
   benchmark, derive a set of `equipment_tag` matches. **Plain filtering and tagging logic only.**
2. Query `ecm_library` for rows matching `sector_or_cluster` + any matched `equipment_tag`. Rank by
   relevance — proximity of the facility's gap to the ECM's typical savings range. In-range rows
   beat out-of-range rows (`relevance`: lower is more relevant).
3. If nothing matches, return `status: "no_match"` with `ECM_NO_MATCH_MESSAGE`
   (`"no matching ECM in library"`). **Never an improvised measure.**

### 10.5 The LLM's only job

Turn a matched row's **own fields** into a readable sentence, e.g.
*"Based on your induction furnace usage, consider: {ecm_name} — {description} (typical savings
{typical_savings_range}, source: {source_reference})."*

The model **must not add any technical detail absent from the row**. Validate that the generated
text introduces no equipment, numbers, or claims not present in the source row; on failure, fall
back to `presentation: "raw_row"` and show the row unstyled.

### 10.6 UI requirement

Every suggested ECM must display its `source_reference` **visibly, not in a tooltip**. This is a
recommendation with real cost implications; the auditor must be able to independently verify it
rather than trust the app.

### 10.7 Tests

- Matching unit tests against fixture data, **no LLM in the test path**.
- Groundedness test in the same spirit as Feature 1.
- Empty-match test: the module must say so plainly rather than improvise.

---

## 11. Auth

Supabase Auth, with email/password, **Google OAuth**, and password recovery.

Dashboard configuration required:

- **Authentication → URL configuration**
  - Site URL: `http://localhost:3000` (or the production URL)
  - Redirect URLs must include `http://localhost:3000/auth/callback` and
    `https://YOUR-DOMAIN/auth/callback`
- **Authentication → Providers → Google** = enabled
- SMTP configured — password reset needs email delivery.

Notes:

- `getSession()` orders membership queries by `created_at` then `organization_id` so that a user
  with multiple memberships resolves to a **stable** primary organisation.
- `updateSession.ts` lists `APP_PREFIXES` (including `/forbidden`) that redirect to login without a
  session.
- `homePathFor(role)` sends `firm_admin` to `/team` and everyone else to `/engagements`.
- Self-serve signup is gated by `backend/lib/auth/signupPolicy.ts`. `/api/auth/signup` creates a
  confirmed user with the service role because hosted Auth caps outbound mail on new projects —
  acceptable for a pilot, **must be closed before real customers**.

---

## 12. Environment variables

Copy `.env.example` to **`frontend/.env.local`** — Next loads env from its own project root, not
the repo root.

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=       # publishable sb_publishable_... or legacy anon JWT
SUPABASE_SERVICE_ROLE=               # server only — NEVER prefix NEXT_PUBLIC

# Gemini — extraction, citation embeddings, optional CAR polish
GEMINI_API_KEY=                      # unset is safe: extract 503s, CAR falls back to template
GEMINI_MODEL=gemini-2.5-flash

# Factor stewardship (D8)
VERIFYSTACK_STEWARD_EMAILS=          # comma-separated; unset = nobody can change a value

# Self-serve signup
AUTH_OPEN_SIGNUP=                    # false = invite-only
AUTH_SIGNUP_ALLOWED_DOMAINS=         # restrict self-serve signup to these domains

# Inngest
INNGEST_EVENT_KEY=
INNGEST_SIGNING_KEY=

# Sentry (optional)
NEXT_PUBLIC_SENTRY_DSN=
SENTRY_DSN=
SENTRY_AUTH_TOKEN=
```

**The app boots without any of these.** Marketing and `/workbench` work with no keys; authenticated
app routes show a "configure Supabase" empty state.

---

## 13. How to exercise the pipeline

1. `npm install`, then `npm run dev`.
2. Apply migrations `0001` → `0011` to a Supabase project, plus `backend/supabase/seed/packs.sql`.
3. Sign in, create an organisation + membership (`/api/bootstrap` handles first-run bootstrap).
4. As `lead_verifier`, create an engagement — pick a CCTS or ADEETIE pack.
5. **Seed synthetic facts** with the one-click button on the facts ledger or runs page. For ADEETIE
   this also fills enterprise and finance context, which the eligibility rules need. It covers all
   14 ADEETIE sectors via `backend/demo/adeetieFacts.ts` and is phase-aware (baseline vs.
   post-implementation).
6. Execute a run on `/engagements/[id]/runs`. Run readiness shows hard blockers and, separately,
   **warnings** — a non-draft engagement is warned rather than blocked, so it runs and then fails
   specifically on unverified factors.
7. Open `/engagements/[id]/findings` for findings + the citation panel; ingest the corpus first via
   `backend/demo/ingestCitations.ts` for citations to appear.
8. Open `/engagements/[id]/ecm` for ECM suggestions (synthetic banner will be visible).
9. Sign off at `/engagements/[id]/signoff` — lead and independent reviewer are separate people.

Everything synthetic is labelled synthetic in the UI. Keep it that way.

---

## 14. Working agreements for the agent

1. **Read before writing.** `AGENTS.md`, `README.md`, `verifystack_low_level_dfd.md`, and the
   relevant `node_modules/next/dist/docs/` guide.
2. **Run the full gate before claiming done:** `npm run typecheck && npm test && npm run lint`.
3. **Never widen a capability to make something work.** If a page needs data a role cannot see,
   the design is wrong, not the capability map.
4. **Never let an LLM call skip its retrieval or grounding step "just for the demo."** That is
   precisely the shortcut that puts a hallucinated citation in front of a regulator.
5. **Do not ingest all nine CCTS sectors' documents.** Ingest only the sectors the working pack
   covers; expand later.
6. **Escalate rather than improvise** on anything touching real-world engineering advice, factor
   values, or regulatory text. Flag it to the project owner.
7. Shell environment is **PowerShell on Windows**. `curl` is aliased to `Invoke-WebRequest`; use
   `curl.exe` for real curl flags. `&&` chaining and `mv` do not behave as in bash — use
   `Move-Item` etc.

---
---

# 15. BPF2026 / BITSoM Vertex submission — drafted answers

Source: `_BPF2026_PrototypeSubmission__VerifyStack.pdf`. The deck explicitly asks you to
**"focus on demonstrating the reasoning behind your decisions rather than making marketing
claims"** and to support answers with evidence, architecture diagrams, and screenshots. The drafts
below follow that instruction — they are written from what the code actually does, so every claim
is verifiable in the repo.

Answers marked **🟢 ready** are grounded in the codebase and can be used close to as-is.
Answers marked **🟡 needs your input** have the reasoning drafted but a factual gap only you can
fill. Sections marked **🔴 yours entirely** cannot be drafted from code at all — they are in §16.

---

## Startup Snapshot

### 1. What does your startup do — 🟢 ready

VerifyStack is an operational verification workbench for India's BEE-administered industrial
compliance schemes — CCTS (the Carbon Credit Trading Scheme) and ADEETIE (the energy-efficiency
technology adoption scheme).

We sell exclusively to the **verifier** — Accredited Carbon Verification Agencies and empanelled
energy auditors — and never to the audited entity. That constraint is the product: our user is a
professional whose signature carries statutory liability, so the software's job is to make their
evidence trail defensible under scrutiny, not to make a facility's numbers look better.

Concretely, VerifyStack takes a verifier from raw facility evidence (electricity bills, fuel
records, production logs, calibration certificates) to a named, reproducible sign-off — hashing
every document at intake, forcing document/page/bounding-box provenance on every extracted number,
computing the regulated metric in a pure versioned engine, and hash-chaining every calculation run
so a result from a year ago is still re-derivable.

### 2. What milestone best represents your progress so far? — 🟡 needs your input

**Working end-to-end prototype with the full regulated pipeline implemented, pre-first-customer.**

What is genuinely built and tested (not slideware):

- All **9 CCTS sectors** and all **14 ADEETIE Phase-1 sectors** are runnable methodology packs.
- The complete P1→P7 pipeline: engagement setup, hashed document intake, Gemini extraction with
  provenance validation, human review gate, hash-chained calculation runs, findings with severity,
  and split lead/independent sign-off.
- A four-role RBAC model with structural maker–checker separation (§6).
- Two AI features with programmatic groundedness gates (§9, §10).
- A public zero-config demo at `/workbench` (an Aravalli Cement facsimile) that runs with no API
  keys at all.
- Deterministic core under test: units, factors, calculation engine, reconciliation rules, golden
  tests.

> **Your input needed:** pick the framing that is *true* — do you have any signed pilot, LOI, or
> design-partner conversation with a verification firm yet? That single fact changes this answer
> from "prototype" to "pilot-stage" and reviewers weight it heavily. See §16.1.

---

## Problem Understanding

### 1. What problem are you solving, and who experiences it most acutely? — 🟢 ready

India has just made industrial carbon and energy compliance **mandatory and auditable**, but the
verification layer that must certify it still runs on spreadsheets and email.

The acute sufferer is the **verifier**, not the factory. A verifier signs a statement that a
facility's emission or energy intensity is accurate. That signature carries professional and
statutory liability, and it is issued today on the basis of:

- Numbers retyped by hand from PDF bills and logs into Excel, with no link back to the source page.
- Sector-specific normalization rules applied from memory or a colleague's old workbook.
- Emission and energy factors of uncertain vintage, with no record of who checked them or when.
- A calculation whose result cannot be reproduced later, because the workbook has since been edited.

So the real problem is **defensibility, not arithmetic**. When a regulator, a buyer of carbon
credits, or a lender questions a number years later, the verifier frequently cannot reconstruct how
it was derived, what evidence supported it, or which version of which rule applied. That is
career-and-licence risk, and it is structurally unsolvable in a spreadsheet.

A secondary sufferer is the **audited enterprise** — particularly the MSMEs in ADEETIE — because
verification slowness and rework gate their access to interest subvention on efficiency loans.

### 2. What evidence validates that this is a meaningful problem worth solving? — 🟡 needs your input

The **structural** evidence is strong and citable:

- Compliance is now mandated rather than voluntary, which converts verification from a
  nice-to-have into a legal precondition — CCTS obligates verification by *accredited* agencies,
  and ADEETIE requires audits by *empanelled* auditors.
- The scheme design itself forces rigour we can point at: ADEETIE runs three sequential phases
  (IGEA → DPR → M&V) with a **money gate** — interest subvention depends on the DPR, and M&V must
  show savings "achieved and sustained." A weak audit trail directly blocks disbursement.
- Verifier capacity is the bottleneck, not demand: the accredited/empanelled pool is small and
  fixed by accreditation, while the obligated-entity population is large. Anything that raises
  throughput per verifier has non-linear value.
- Normalization is genuinely sector-specific, which is why our packs enforce that *every rule
  carries a clause citation* — a verifier cannot defend a normalization they cannot cite.

> **Your input needed — this is the single biggest gap in the submission.** The deck asks for
> "customer insights" and "evidence," and reviewers will discount structural/regulatory reasoning
> if there is no primary research behind it. See §16.1 for exactly what to supply. Even 3–5
> recorded conversations with verifiers, quoted, would transform this answer.

---

## Customer & Market

### 1. Who is your ideal customer, and who makes the buying decision? — 🟢 ready

**Ideal customer:** a small-to-mid Accredited Carbon Verification Agency or BEE-empanelled energy
audit firm — roughly 5–40 professionals — running multiple concurrent engagements across sectors.
They are large enough to feel the coordination and defensibility pain, and small enough to lack an
in-house engineering team to build internal tooling.

**Who decides:** the firm's **partner / lead verifier** — the person who personally signs off and
therefore personally carries the liability. This is unusually clean as a sale, because the
economic buyer and the liability bearer are the same individual, and the pain is theirs.

Evidence that we designed for this rather than assumed it: our role model separates `firm_admin`
(firm operations — team management and the audit log) from `lead_verifier` (the verification
lifecycle and sign-off). The admin deliberately **cannot** see operational verification data. We
built for the reality that the signer and the office manager are different people with different
needs.

**Who is explicitly not the customer:** the audited entity. Selling to both sides would compromise
the independence that makes a verifier's signature worth anything.

### 2. How large is the opportunity you are targeting? — 🟡 needs your input

The honest bottom-up structure of the market is:

```
  (number of accredited CVAs + empanelled energy auditors in India)
× (seats per firm, or engagements per firm per year)
× (price per seat/year or per engagement)
= addressable revenue
```

Each of those three numbers needs a real source, and **none of them exist anywhere in the
codebase**, so any figure drafted here would be invented — which is precisely the "marketing claim"
the deck warns against.

What is defensible without those numbers: the market is **regulatorily created and gated**. The
number of firms permitted to do this work is set by accreditation and empanelment, so the customer
list is finite, enumerable, and publicly knowable from BEE registries. That is a rare and good
property — you can literally count your TAM rather than estimate it.

> **Your input needed:** see §16.2. Pull the current accredited-CVA and empanelled-auditor counts
> from BEE/BEE-adjacent registries, and decide pricing. Then this becomes a strong, sourced answer.

---

## Solution Overview

### 1. What is your solution, and how does it solve the identified problem? — 🟢 ready

VerifyStack is a workbench built on one inversion of the usual AI product logic: **code computes,
models never do.**

The calculation engine is pure, deterministic, and versioned. A language model is never permitted
to perform arithmetic, derive a factor, or produce any number that flows into a result. Models are
restricted to retrieving real source text and drafting prose, and every one of their outputs is
created in a `suggested` state that a named human must accept, edit, or reject.

That maps onto the problem as follows:

| Verifier's problem | How VerifyStack removes it |
| --- | --- |
| Numbers retyped with no link to source | No value without provenance — document id, page, bounding box, verbatim text, or the value is dropped to the audit log rather than stored |
| Normalization applied from memory | Methodology packs are **data, not code paths**; pack validation refuses a runnable pack whose rules lack clause citations |
| Factors of unknown vintage | A run depending on an unverified factor **fails**, unless the engagement is explicitly in draft mode |
| Result cannot be reproduced later | Every run records engine version, pack version, and input hash, and is hash-chained to its predecessor |
| Signature risk concentrated in one person | Maker–checker enforced structurally: `signoff.lead` and `signoff.reviewer` are held by different roles and **no role holds both** |
| Citation risk from AI | Retrieval-not-recall, with a programmatic groundedness gate that rejects any citation the model did not receive in context |

### 2. What are the core capabilities of your product? — 🟢 ready

1. **Multi-scheme methodology packs as data.** 9 CCTS sectors (GEI) and 14 ADEETIE Phase-1 sectors
   (SEC), all runnable. Adding a sector never means adding a branch in the engine. Packs are
   immutable once bound — a database trigger (`engagements_forbid_pack_rebind`) prevents swapping
   an engagement's methodology after the fact.
2. **Hashed evidence intake.** Documents hashed at upload, served via signed URLs, paginated for
   review.
3. **Provenance-gated extraction.** Gemini proposes field values; anything lacking
   document/page/bbox/source-text provenance is discarded to the audit log.
4. **A human review gate.** High-materiality fields always require a named reviewer.
5. **A deterministic, versioned calculation engine** with golden tests, plus reconciliation rules
   with `block | warn | info` severity. An open `block` finding prevents both sign-off and an
   ADEETIE phase advance.
6. **Hash-chained calculation runs** for permanent reproducibility.
7. **The Regulatory Citation Assistant** (§9) — retrieves the exact applicable clause from an
   ingested corpus via pgvector, filtered by scheme and sector *before* similarity search, and
   programmatically rejects any citation outside the retrieved set.
8. **The ECM Recommendation Module** (§10) — deterministic matching from a curated library, with
   the LLM restricted to restyling a matched row's own fields.
9. **The full ADEETIE lifecycle** — IGEA → DPR → M&V, strictly sequential, each phase running its
   own complete verification cycle, with eligibility rules covering enterprise category, loan
   structure, debt share, subvention rate, and 200 km cluster proximity.
10. **Capability-based RBAC** across four roles, with a single source of truth that nav, pages, and
    APIs all consult.
11. **A complete audit trail** — `audit_events` plus a dedicated `ai_action_logs` table, so every
    AI action is itself auditable.
12. **Two-tier factor stewardship** (§6.4) — the platform owns published factor *values*; the firm
    attests *vintage* against a citation.

### 3. What measurable value does your solution deliver? — 🟡 needs your input

The mechanisms that produce value are concrete and demonstrable in the product:

- **Rework avoided** — reconciliation rules catch an incomplete baseline year or a non-closing
  energy balance *before* a report is issued, rather than after a regulator returns it.
- **Time to defend a past number** — reconstructing a year-old result goes from a forensic hunt
  through email and workbook versions to opening a hash-chained run record.
- **Throughput per verifier** — provenance-gated extraction removes manual retyping, the bottleneck
  activity in a capacity-constrained profession.
- **Citation risk eliminated by construction** — a hallucinated clause cannot reach the auditor,
  because the gate is code, not a prompt instruction.

> **Your input needed:** the deck asks for *measurable* value, and honest baselines require a real
> engagement. See §16.1. Two or three before/after numbers from a single pilot ("baseline
> reconciliation took 6 days, now 2") would carry more weight with reviewers than any projection.

---

## Technology & AI Architecture

### 1. Solution architecture end-to-end, including data flow and major components — 🟢 ready

> Attach `verifystack_low_level_dfd.md` (the low-level DFD) and a screenshot of the findings screen
> with the citation panel open. The deck explicitly asks for architecture diagrams.

**Shape:** an npm workspaces monorepo with exactly two source workspaces and **no HTTP hop between
them**. `frontend/` is a Next.js App Router project; `backend/` is `@verifystack/backend`
(`domain/`, `lib/`, `inngest/`, `demo/`, `supabase/`). The frontend imports backend domain modules
directly and Next bundles them from source. Deliberate: it removes a network boundary, keeps the
domain layer independently unit-testable, and keeps one type system across the whole stack.

**Stack:** Next.js App Router · TypeScript · Supabase (Postgres + Auth + Storage) · pgvector ·
Inngest for background jobs · Gemini for extraction/retrieval/drafting · Zod at every trust
boundary · Vitest.

**Data flow, P1 → P7:**

```
P1  Engagement & pack setup      → engagement bound immutably to a methodology pack
P2  Document intake              → hashed upload → Storage + documents/document_pages
P3  Extraction (Inngest+Gemini)  → extracted_fields, each carrying doc/page/bbox/source text
                                   ⤷ provenance missing → dropped to audit log, never a fact
P4  Human review gate            → reviewer accepts/edits/rejects → facts ledger
P5  Calculation run              → pure engine reads facts via pack bindings
                                   ⤷ unverified factor → run FAILS (unless draft mode)
                                   ⤷ records engine ver + pack ver + input hash, hash-chained
P6  Findings                     → reconciliation rules → block | warn | info
                                   ⤷ Feature 1 retrieves the governing clause  (gated)
                                   ⤷ CAR language drafted from a template      (gated)
P7  Sign-off                     → lead_verifier AND independent_reviewer, separate people
                                   ⤷ any open block finding prevents sign-off
```

**Data stores:** 11 ordered migrations. Core tables are `organizations`, `memberships`,
`methodology_packs`, `engagements`, `documents`, `document_pages`, `extraction_jobs`,
`extracted_fields`, `facts`, `calculation_runs`, `findings`, `signoffs`, `factor_records`,
`audit_events`, `ai_action_logs`; then `sec_runs`, factor verification tables, `adeetie_clusters`,
`adeetie_measures`, and finally `regulatory_documents` / `regulatory_chunks` (Feature 1) and
`ecm_library` (Feature 2).

**Multi-tenancy:** Postgres **Row Level Security is the primary boundary**, with every org-scoped
table carrying policies keyed on `is_org_member(organization_id)`. Application reads go through an
org-scoped data layer (`backend/lib/data/*`). The service-role key — which bypasses RLS — is used
only for hashed uploads, signed URLs, and seeding, and **never on a request path that reads user
data**. Tenancy therefore holds even if an application-layer check is missed.

**Graceful degradation:** the app boots with no environment variables at all. Marketing and the
public `/workbench` demo work with zero keys; authenticated routes show a configure-Supabase empty
state; without `GEMINI_API_KEY`, extraction returns a clean 503, CAR drafting falls back to the
grounded template, and citations report `unavailable` rather than silently emitting a zero vector.

### 2. What role does AI play, and which workflows are powered by it? — 🟢 ready

**This is our most differentiated answer, and the role is deliberately narrow.**

AI does exactly three things, and is architecturally prevented from doing anything else:

| # | Workflow | What the model does | The hard constraint |
| --- | --- | --- | --- |
| 1 | **Document extraction** (P3) | Proposes field values from bills, logs, certificates | Every value must carry document id, page, bounding box, verbatim source text. No provenance → dropped to the audit log, never persisted as a fact |
| 2 | **Regulatory citation** (§9) | Explains why a *retrieved* clause applies | Retrieval-not-recall. Filter by scheme+sector, then pgvector similarity, then pass **only retrieved chunk text**. Post-generation, code verifies every citation string appears in a chunk that call actually received. Outside the set → **reject**, attach nothing, route to a human |
| 3 | **Prose drafting** (§10, CAR) | Restyles a matched library row's own fields into a readable sentence | Must introduce no equipment, number, or claim absent from the source row. On failure, fall back to the raw row unstyled |

**What AI never does — enforced, not requested:** no arithmetic, no factor derivation, no number
that reaches a result, no auto-accept. Every output is born `suggested`.

The three design choices we would most want a reviewer to notice:

1. **Groundedness gates are programmatic, not prompt-based.** "The system instruction said not to
   hallucinate" is not a control. Feature 1 emits one of four explicit gate states —
   `grounded`, `rejected`, `no_applicable_clause`, `unavailable` — and only `grounded` output
   reaches the auditor. Adversarial tests assert that a violation with no matching clause returns
   *"no applicable clause found"* rather than forcing a citation.
2. **We chose to constrain the model where the stakes are physical.** ECM matching is deterministic
   filtering and ranking with **no LLM in the path**, because a fabricated engineering intervention
   carries real safety and cost consequences. The library ships behind
   `ECM_LIBRARY_PRODUCTION_READY = false` with a visible "synthetic — not for production decisions"
   banner, and we are explicit in the code that populating it requires a published BEE guide plus a
   domain-advisor review — a research task, not a scripting task. **We would rather ship the
   feature visibly disabled than ship a plausible-looking wrong recommendation.**
3. **AI actions are themselves audited.** A dedicated `ai_action_logs` table plus a versioned
   prompt identifier (`CITATION_PROMPT_VERSION`) means we can answer "what did the model see, and
   which prompt version produced this?" months later.

This is what "responsible application of AI" means in a regulated setting: the interesting
engineering is in the constraints, not the generation.

---

## Competitive Advantage

### 1. What alternatives exist today, and how does your solution compare? — 🟡 needs your input

| Alternative | Where it falls short for a verifier |
| --- | --- |
| **Excel + email** (the real incumbent) | No provenance link to source pages, no reproducibility once the workbook is edited, no maker–checker, no factor vintage record |
| **Global ESG / carbon accounting platforms** | Built for the *reporting entity* to compute its own footprint, not for an independent verifier to challenge it. No CCTS/ADEETIE methodology packs, no Indian scheme lifecycle, and wrong side of the independence line |
| **Generic document-AI / IDP tools** | Extract fields but carry no methodology, no reconciliation rules, no clause citation, and no sign-off model. They solve step P3 of seven |
| **In-house spreadsheets + a developer** | What larger firms do; breaks down across 23 sector methodologies and cannot produce a hash-chained audit trail |
| **A general LLM assistant** | Recalls regulations from training data — the exact failure mode Feature 1 exists to prevent |

> **Your input needed:** name the *actual* named competitors verifiers mentioned to you, and
> whether any incumbent tool is already in use at firms you have spoken with. See §16.3.

### 2. If a foundation-model provider shipped this feature tomorrow, why do you still win? — 🟢 ready

Because a foundation model can ship **capability**, and almost none of our product is capability.

1. **Our value is in refusal, not generation.** A better model makes hallucinations more fluent and
   therefore more dangerous. Our differentiator — filter by scheme and sector, retrieve, then
   programmatically reject any citation outside the retrieved set — is a control system around a
   model. It gets *more* valuable as models get more persuasive, not less.
2. **The regulated system of record is not a model feature.** Hash-chained runs, immutable pack
   binding enforced by a database trigger, RLS-based tenancy, structural maker–checker separation,
   provenance-or-discard, factor stewardship split between platform and firm — a model provider
   ships none of this, and it is what makes a signature defensible.
3. **23 sector methodologies encoded as data.** Nine CCTS GEI packs and fourteen ADEETIE SEC packs,
   with stream and energy bindings, `sec_config`, reconciliation rules, and a clause citation
   required on every rule. This is accumulated domain encoding, and it deepens with each engagement.
4. **The scheme lifecycle is the moat, not the text generation.** ADEETIE's IGEA → DPR → M&V
   sequence with a subvention gate, eligibility rules spanning enterprise category, loan structure,
   debt share and cluster proximity — that is workflow modelling of an Indian regulatory scheme.
5. **We are a wrapper by design, and we swap the model.** `GEMINI_MODEL` is a config value. A
   better, cheaper model is an upgrade we absorb in one line, not a competitor.
6. **Trust and independence compound.** We sell only to verifiers, never to audited entities. That
   position, once established with accredited firms, is not something a model provider can occupy.

The short version: **a smarter model makes the generation step better, and the generation step is
the part of our product we deliberately trust least.**

---

## Vision & Roadmap

### 1. What are your next major product and business milestones? — 🟡 needs your input

The **product** milestones are unambiguous, because the code already flags them:

1. **Ingest the real regulatory corpus** (Feature 1 blocker). Today's corpus is a synthetic
   Foundry + Cement set. Production needs the actual BEE PAT normalization pro-formas, the CCTS
   Detailed Procedure for Compliance Mechanism, sector methodology documents, and ADEETIE
   operational guidelines. Then tune `MIN_RETRIEVAL_COSINE` (currently a guessed `0.28`) against a
   labeled set of violation→clause pairs.
2. **Seed and verify `ecm_library`** (Feature 2 blocker). Requires a published BEE sector ECM guide
   and a named domain advisor's review before `ECM_LIBRARY_PRODUCTION_READY` flips to `true`.
3. **Close the pilot-security gap.** `/api/auth/signup` currently creates confirmed users via the
   service role because hosted Supabase Auth caps outbound mail on new projects. Configure SMTP,
   set `AUTH_OPEN_SIGNUP=false`, move to invite-only.
4. **Deploy to production** with env vars set and the production `/auth/callback` registered.
5. **Run one real engagement end to end** with a design-partner firm — the only true validation of
   the pipeline.

> **Your input needed:** the **business** milestones (first paying firm, pilot count, revenue,
> hiring, accreditation relationships) are entirely yours. See §16.4.

### 2. What is your long-term vision for the startup? — 🔴 yours entirely

See §16.4. A defensible direction the architecture already supports, if it matches your intent:
VerifyStack becomes the **system of record for regulated industrial verification in India** — the
place where a defensible number is produced, and where a regulator, lender, or credit buyer can
trace any published figure back to a hashed source page. The pack-as-data design means new schemes
are new data, not new products; the ADEETIE money gate hints at the adjacency (lenders and
subvention administrators consuming verified outputs). But the actual ambition, sequencing, and
whether you want to move toward the lending side is a founder decision, not an inference.

---

## Team · Why BITSoM Vertex · Supporting Material

🔴 **Yours entirely** — nothing in the codebase can answer these. See §16.5 and §16.6.

---
---

# 16. QUESTIONS ONLY YOU CAN ANSWER

Everything below is a genuine gap. Some blocks the BPF submission, some blocks production. **Do not
let an AI invent answers to any of these** — fabricated traction or invented market numbers are
exactly what a reviewer will probe, and invented regulatory thresholds would put wrong numbers into
a compliance product.

### 16.1 Customer validation — the biggest weakness in the submission

The deck weights "clearly validated customer problem" and "product maturity supported by customer
validation and measurable traction" heavily, and right now we have **strong regulatory reasoning
and zero primary evidence**. To fix it:

1. **Have you spoken to any verification firm, ACVA, or empanelled energy auditor?** How many, and
   can you quote them? Even 3–5 conversations, with direct quotes about how they handle
   normalization and reproduce old numbers today, would carry the whole Problem Understanding
   section.
2. **Is there any signed pilot, LOI, MoU, or design partner?** This determines whether §15's
   milestone answer says "prototype" or "pilot-stage."
3. **The industry guide you were meeting** — did that conversation happen, what did they say, and
   can they be named as an advisor? (Referenced in earlier work as a meeting scheduled with a
   potential guide.)
4. **Any before/after numbers from a real engagement** for the "measurable value" question — even
   one honest baseline beats a projection.

### 16.2 Market sizing

5. **How many accredited CVAs and BEE-empanelled energy auditors currently exist?** Needs a citable
   registry source and an as-of date.
6. **What is the pricing model** — per seat per year, per engagement, or per verified facility —
   and at what price point?
7. **What is the realistic engagement volume** per firm per year? These three numbers are the only
   missing inputs to a bottom-up TAM.

### 16.3 Competitive landscape

8. **Which competitors do verifiers actually name?** Any tool already in use at firms you have
   spoken to, and is anyone else building specifically for the CCTS/ADEETIE verifier?

### 16.4 Business roadmap and vision

9. **Business milestones for the next 6–12 months** — first paying customer, pilot count, revenue
   target, hires?
10. **The long-term vision** — how far beyond CCTS/ADEETIE, and do you intend to move toward the
    lending/subvention side that ADEETIE's money gate touches?

### 16.5 Team

11. **Who is on the founding team, with roles?**
12. **What domain expertise do you have** in energy auditing, carbon verification, or BEE schemes
    specifically — and what technical background? If domain depth sits with an advisor rather than a
    founder, say so explicitly; reviewers respect a named advisor more than an implied credential.

### 16.6 BITSoM Vertex and supporting material

13. **Why have you applied to BITSoM Vertex,** and **which single challenge is most limiting your
    growth right now?** (Candidly: based on the state of the repo, the honest answer is likely
    customer access to accredited verification firms and a domain advisor to validate regulatory
    content — but this must be your answer, not mine.)
14. **Supporting links, all required by the deck:**
    - Deployed project link — **not deployed yet**, see §16.8
    - Demo video (3–5 min) — not recorded. The public `/workbench` demo needs no API keys and is
      the natural thing to record.
    - Website
    - GitHub repository — is `https://github.com/shahmehul2005/verifystack` still correct, and is
      it public? See §16.8.
    - Product documentation — `README.md` and this file could serve; do you want a hosted version?
    - Contact details

### 16.7 Regulatory content — blocking production, and a correctness risk

15. **Who is the domain advisor who will validate `ecm_library`?** `ECM_LIBRARY_PRODUCTION_READY`
    stays `false` until a named person with energy-audit credentials signs off on the rows.
16. **Which published BEE sector ECM guides are the source?** Exact titles, years, and section
    numbers are needed for `source_reference`. Which sectors first?
17. **Should the ECM feature be visible at all before the library is verified?** Today it renders
    with a prominent synthetic-data banner. Keep it, hide it behind a flag, or remove the nav entry?
18. **Which regulatory source documents should be ingested for Feature 1, and where are the files?**
    Needed as files or stable URLs: BEE PAT normalization pro-formas, the CCTS Detailed Procedure
    for Compliance Mechanism, sector methodology documents, ADEETIE operational guidelines.
19. **Confirm the sector priority for ingestion** — the rule is to ingest only what the working pack
    covers. Which sector is the demo pack for your next conversation?
20. **Is `MIN_RETRIEVAL_COSINE = 0.28` acceptable?** It is a guess. Tuning needs roughly 20 labeled
    (rule violation → correct clause) pairs from someone who knows the regulations. Can you or an
    advisor produce them?
21. **What are the actual ADEETIE scheme minimum thresholds** for DPR projected savings, eligible
    loan range, and permitted debt share? These drive live eligibility rules and must be confirmed
    against the scheme document rather than inferred.
22. **Should ADEETIE M&V "sustained savings" have a defined measurement window?** The exit gate says
    savings must be "achieved and sustained," but no duration is encoded.

### 16.8 Security, operations, and deployment

23. **Should self-serve signup be closed now?** `/api/auth/signup` creates *confirmed* users via the
    service role, bypassing email verification, because hosted Auth caps outbound mail. Acceptable
    for a pilot, wrong for real customers. Set `AUTH_OPEN_SIGNUP=false` and/or
    `AUTH_SIGNUP_ALLOWED_DOMAINS` — and is SMTP configured yet?
24. **Which emails go in `VERIFYSTACK_STEWARD_EMAILS`?** The only people who can change a catalogue
    factor *value*. Unset today, meaning nobody can.
25. **What is the factor re-verification cadence, and whose obligation is it?** The two-tier model
    assumes the platform refreshes published values and each firm attests vintage. Is monthly right,
    and should the firm's obligation surface as a task or reminder?
26. **Is Vercel still the deployment target, and is the project connected?** Needs the §12 env vars
    set in the dashboard and the production `/auth/callback` added to Supabase redirect URLs.
27. **Has the repo been pushed?** There is a large body of uncommitted work — Features 1 and 2 plus
    the RBAC, auth, and ADEETIE fixes. Confirm the remote, and whether to commit as one change or
    split into reviewable pieces.

### 16.9 Product model

28. **Is the four-role model correct for a real firm?** Specifically: should `firm_admin` truly be
    unable to see operational verification data, and does any real firm have one person acting as
    both lead verifier and independent reviewer? The code structurally forbids it — confirm that
    matches practice.
