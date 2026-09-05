# VerifyStack

Operational verification workbench for India's BEE-administered compliance schemes — **CCTS** (Accredited Carbon Verification Agencies) and **ADEETIE** (empanelled energy auditors).

Sold only to **verifiers**. Never to the audited entity.

## Status

Production build in progress. The deterministic core (units, factors, calculation engine, reconciliation rules) is tested. App Router shells, methodology packs, hashed document intake, review workbench, hash-chained calculation runs, findings, and named sign-off are in the tree. Live Supabase / Inngest / Gemini are optional: the app boots without keys.

## Quickstart

```bash
npm install
cp .env.example frontend/.env.local   # optional; marketing works without keys
npm test
npm run typecheck
npm run dev
```

- Open `/` for marketing.
- Open `/login` — if Supabase env is missing you will see a configure empty state.
- Pack catalogue at `/packs` (all 9 CCTS sectors and all 14 ADEETIE Phase 1 sectors are runnable).

### With Supabase

Apply `backend/supabase/migrations/0001_init.sql` and `backend/supabase/seed/packs.sql` to a project. Set:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE` (server only — hashed uploads and signed storage)

Env vars are read by Next, so they belong in `frontend/.env.local` (or the deployment
environment), not the repo root.

Then create an organisation + membership and start a **CCTS-CEMENT-v1** engagement. See `backend/supabase/seed/aravalli.md`.

Gemini (`GEMINI_API_KEY`) enables live classify/extract. Inngest (`INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`) runs intake and extraction jobs. Without those keys, upload still hashes and stores; extraction jobs fail with a clear error.

## Design rules

1. **Code computes, models never do.** The calculation engine is pure and versioned. Models never perform arithmetic.
2. **No value without provenance.** Document, page, bounding box, source text — or the value is dropped to the audit log.
3. **AI proposes, humans decide.** High-materiality fields always require a named reviewer.
4. **Reproducible forever.** Every run records engine version, pack version, and input hash, and is hash-chained.
5. **Unverified factors are refused** unless the engagement is in draft mode.

## Layout

Two npm workspaces, `backend/` and `frontend/`. The frontend imports the backend
directly as a workspace package — there is no HTTP hop between them.

```
backend/domain/            units, factors, engine, rules, packs, extraction, calc/run.ts
backend/lib/supabase/      clients, Database types, session
backend/lib/auth/          getSession, requireRole, auditEvent
backend/lib/data/          engagement queries
backend/inngest/           intake + extract functions
backend/demo/              Aravalli cement seed + pipeline
backend/supabase/          Postgres migrations + RLS + evidence bucket, seed data
frontend/app/(marketing)   landing + privacy / DPDP
frontend/app/(auth)        login + invite
frontend/app/(app)         engagements, review queue, packs, factors, audit, team
frontend/app/workbench     public cement demo (HTML facsimiles)
frontend/app/api/          route handlers
frontend/components/       UI kit, app shell, workbench viewer
frontend/lib/              cn, format, route-handler error mapping
frontend/proxy.ts          Next 16 session gate
```

`frontend/` is the Next.js project root; run every npm script from the repo root.
Backend modules are imported as `@verifystack/backend/<path>`; frontend-internal
imports keep the `@/` alias.

Process 3.0 and 5.0 load a **Methodology Pack**. They do not contain sector `if` branches.

## Privacy / DPDP

Evidence files may be sent to Google Gemini for classification and extraction when a Gemini key is configured. See `/privacy`.

## Tests

```bash
npm test          # units, engine, rules, pack loader, hash/dedupe, RLS helpers, run hashing, sign-off guards
npm run typecheck
npm run lint
```

CI: `.github/workflows/ci.yml` (lint, tsc, vitest).

## Deploy on Vercel

This is **one Next.js app**, not a split frontend/backend. Vercel runs `frontend/`; that app imports `backend/` from source. Host Postgres/Auth/Storage on [Supabase](https://supabase.com). Optional: [Inngest Cloud](https://www.inngest.com) for long extracts, Gemini for document extraction.

1. Push this repo to GitHub (already the default remote).
2. [Import the project](https://vercel.com/new) from `shahmehul2005/verifystack`.
3. Framework Preset: **Next.js**. Root Directory: **`frontend`**. Enable *Include source files outside of the Root Directory in the Build Step*.
4. Leave Install / Build as the values in `frontend/vercel.json` (`npm install --prefix ..` then `npm run build`).
5. Add env vars from `.env.example` (never put `SUPABASE_SERVICE_ROLE` or `GEMINI_API_KEY` on a `NEXT_PUBLIC_` name).
6. Apply every file in `backend/supabase/migrations/` on the Supabase project, then `backend/supabase/seed/packs.sql`.
7. Hobby functions time out at 10s; multi-page extract sets `maxDuration = 300` and needs **Pro** (or run extracts via Inngest).

## Out of scope

ICM portal, vendor e-sign (DocuSign etc.), verifying CEA/IPCC numbers, extractors for production_log/weighbridge beyond Cement, offline app, second LLM cross-check.

## License & contact

This repository is maintained by the VerifyStack authors. See LICENSE for terms.
