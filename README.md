# VerifyStack

Verification workbench for India's BEE-administered compliance schemes:

- **CCTS** (Carbon Credit Trading Scheme) — greenhouse-gas emission intensity (GEI) verification
  for Accredited Carbon Verification Agencies.
- **ADEETIE** — specific energy consumption (SEC), eligibility and savings verification for
  BEE-empanelled energy auditors.

VerifyStack is sold to verifiers only, never to the audited entity.

## Principles

1. **Code computes, models never do.** The calculation engine is pure and versioned. Models
   classify, extract and draft; they never do arithmetic.
2. **No value without provenance.** Every fact carries document, page, bounding box and source
   text, or it is dropped.
3. **AI proposes, humans decide.** Extracted fields, citations, CAR drafts and ECM suggestions
   start as suggestions and need a named accept, edit or reject.
4. **Reproducible runs.** Every run records engine version, pack version and input hash, and is
   hash-chained to the previous run.
5. **Unverified reference data is flagged, never hidden.** The engine refuses unverified factors
   by default; the app runs them with an explicit warning until the platform steward cites them.

## Architecture

One Next.js application in two npm workspaces. There is no HTTP hop between them: the frontend
imports backend modules directly and Next bundles them from source.

| Workspace  | Package                 | Role                                                       |
| ---------- | ----------------------- | ---------------------------------------------------------- |
| `backend`  | `@verifystack/backend`  | Domain logic, data access, auth, background jobs, SQL      |
| `frontend` | `@verifystack/frontend` | Next.js App Router: pages, route handlers, UI components   |

External services: **Supabase** (Postgres + pgvector, Auth, Storage), **Gemini** (extraction and
citation embeddings), **Inngest** (background intake and extraction), **Resend** (email),
**Sentry** (errors). Only Supabase is needed to sign in; the rest degrade with a clear error.

See the [architecture overview](docs/architecture/overview.md) for how the pieces fit, and
[`docs/architecture/data-flow.md`](docs/architecture/data-flow.md) for the process-level data flow
diagrams.

## Repository layout

```
.
├── backend/
│   ├── domain/            Pure domain logic (no I/O)
│   │   ├── units/         Quantities and unit conversion
│   │   ├── factors/       Emission and energy factor catalogue
│   │   ├── calc/          GEI engine, SEC engine, hash-chained runs
│   │   ├── rules/         Reconciliation and eligibility rules
│   │   ├── packs/         Methodology packs (ccts/, adeetie/) and loader
│   │   ├── extraction/    Document schemas, Gemini extraction, provenance checks
│   │   ├── citations/     Regulatory citation retrieval and groundedness gate
│   │   ├── ecm/           Energy conservation measure matching
│   │   ├── ai/            Grounded CAR drafting
│   │   ├── adeetie/       ADEETIE lifecycle (IGEA → DPR → M&V)
│   │   ├── engagements/   Engagement status machine
│   │   ├── signoff/       Maker–checker sign-off guards
│   │   ├── esign/         Signature provider interface
│   │   └── reports/       PDF report templates
│   ├── lib/
│   │   ├── auth/          Session, roles, capabilities, invites, audit log
│   │   ├── data/          Organisation-scoped queries
│   │   ├── email/         Transactional email
│   │   └── supabase/      Clients, generated Database types, session refresh
│   ├── inngest/           Background functions (intake, extract)
│   ├── fixtures/          Synthetic sample plants and documents for tests
│   ├── scripts/           Backend CLIs (citation ingest)
│   └── supabase/          Migrations and catalogue seed
├── frontend/
│   ├── app/
│   │   ├── (marketing)/   Landing and privacy pages
│   │   ├── (auth)/        Login, signup, invites, password reset
│   │   ├── (app)/         Engagements, review queue, packs, factors, team, audit
│   │   ├── api/           Route handlers
│   │   └── auth/          OAuth callback
│   ├── components/        UI kit, app shell, feature components
│   ├── lib/               Formatting and route-handler helpers
│   ├── public/            Static assets
│   └── proxy.ts           Session gate
├── docs/                  Architecture, decisions, domain reference, guides
├── scripts/               Supabase probe and end-to-end smoke scripts
└── .github/workflows/     CI
```

## Getting started

Requires Node.js 20 or later.

```bash
npm install
cp .env.example frontend/.env.local   # then fill in the Supabase keys
npm run dev                           # http://localhost:3000
```

Next.js reads environment variables from `frontend/`, so `.env.local` belongs there, not at the
repo root. Without Supabase keys the marketing pages load and the app shows a configuration
notice. Database setup is in [`docs/guides/supabase-setup.md`](docs/guides/supabase-setup.md).

## Scripts

Run everything from the repo root.

| Command                    | Purpose                                                   |
| -------------------------- | --------------------------------------------------------- |
| `npm run dev`              | Start the development server                              |
| `npm run build`            | Production build                                          |
| `npm start`                | Serve the production build                                |
| `npm test`                 | Unit tests (Vitest) for both workspaces                   |
| `npm run typecheck`        | TypeScript, backend then frontend                         |
| `npm run lint`             | ESLint                                                    |
| `npm run typegen`          | Generate Next.js route types (CI runs this before tsc)    |
| `npm run supabase:probe`   | Check Supabase connectivity; prints counts, never keys    |
| `npm run citations:ingest` | Load the synthetic citation corpus into pgvector          |
| `npm run e2e:firm`         | Smoke test: signup → firm → engagements                   |
| `npm run e2e:flow`         | Smoke test: full CCTS flow through sign-off               |

The Supabase probe and smoke scripts read `frontend/.env.local`. The smoke scripts create real
users in the configured Supabase project and expect `npm run dev` on port 3000.

CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs typegen, lint, typecheck, tests
and build on every push and pull request.

## Contributing

Workflow, code conventions and the rules for engine, pack, migration and AI changes are in
[`CONTRIBUTING.md`](CONTRIBUTING.md). Report vulnerabilities as described in
[`SECURITY.md`](SECURITY.md).

## Deployment

Vercel runs the `frontend/` app, which bundles `backend/` from source.

1. Import the repository in Vercel. Framework preset **Next.js**, root directory **`frontend`**,
   and enable *Include source files outside of the Root Directory in the Build Step*.
2. Keep the install and build commands from `frontend/vercel.json`.
3. Add the variables from `.env.example`. Never put `SUPABASE_SERVICE_ROLE` or `GEMINI_API_KEY`
   behind a `NEXT_PUBLIC_` name.
4. Apply the migrations and seed as described in the Supabase setup guide, and add the
   production `/auth/callback` URL to Supabase Auth.
5. Multi-page extraction sets `maxDuration = 300`, which needs a Vercel Pro plan, or run
   extraction through Inngest.

## Documentation

Start with the [architecture overview](docs/architecture/overview.md). The full index is in
[`docs/README.md`](docs/README.md).

| Document                                                       | Purpose                                    |
| -------------------------------------------------------------- | ------------------------------------------ |
| [Architecture overview](docs/architecture/overview.md)         | How the system works, end to end           |
| [Decision records](docs/decisions/README.md)                   | Why it is built this way                   |
| [Regulatory register](docs/domain/regulatory-register.md)      | Every regulatory value and its verification status |
| [Glossary](docs/domain/glossary.md)                            | Scheme, role and product terms             |
| [Supabase setup](docs/guides/supabase-setup.md)                | Database, storage and auth setup           |
| [Open questions](docs/product/open-questions.md)               | Decisions waiting on founders or reviewers |
| [`CONTRIBUTING.md`](CONTRIBUTING.md)                           | Workflow and conventions                   |
| [`SECURITY.md`](SECURITY.md)                                   | Controls, known gaps, reporting            |
| [`CHANGELOG.md`](CHANGELOG.md)                                 | Release history and engine versions        |

## Privacy

When a Gemini key is configured, evidence files may be sent to Google Gemini for classification
and extraction. See `/privacy` in the app.

## Out of scope

ICM portal integration, vendor e-signature, independent verification of CEA/IPCC figures,
extractors beyond the shipped document schemas, offline use, and a second-model cross-check.

## License

Proprietary. © VerifyStack. All rights reserved.
