# Contributing

Read [`docs/architecture/overview.md`](docs/architecture/overview.md) first. It explains the
system and the invariants every change must keep.

## Setup

```bash
npm install
cp .env.example frontend/.env.local
npm run dev
```

Node.js 20 or later. Run every command from the repository root.

## Workflow

1. Branch from `main`: `feat/…`, `fix/…`, `docs/…`, `chore/…`.
2. Keep each pull request to one change. Move files in a separate PR from changing them.
3. Before opening the PR, run the same checks as CI:

   ```bash
   npm run lint && npm run typecheck && npm test && npm run build
   ```

4. Fill in the pull request template. CI must be green before merge.

Commit messages are short and imperative: `Add Foundry calibration rule`, `Fix invite expiry
check`. Explain *why* in the body when it is not obvious.

## Code conventions

- **Imports.** `@verifystack/backend/<path>` for backend modules from anywhere; `@/<path>` for
  frontend-internal modules. Aliases are declared in `backend/tsconfig.json`,
  `frontend/tsconfig.json` and `vitest.config.mts`; change all three together.
- **Server-only code.** Modules that touch secrets or the database (`lib/supabase/admin.ts`,
  `lib/supabase/server.ts`, `lib/auth/*`, `lib/data/*`, `lib/hash.ts`,
  `domain/extraction/gemini.ts`) start with `import "server-only"`. Never import them from a
  Client Component.
- **Domain purity.** `backend/domain/` does no I/O. Database and network access belong in
  `backend/lib/` or route handlers.
- **File names.** Backend modules are camelCase (`fromFacts.ts`); backend React report templates
  are PascalCase. Frontend files are kebab-case (`review-workbench.tsx`).
- **Tests** sit next to the module as `*.test.ts`. Domain changes need tests; engine changes need
  golden tests.
- **Validation.** Route handler bodies are parsed with Zod.
- **Authorisation.** Check capabilities with `hasCapability` / `requireCapability`. Never widen a
  role to make a page work. Filter every service-role query by the session's organisation.
- **Next.js.** This repo runs Next.js 16. Read the relevant guide in `node_modules/next/dist/docs/`
  before writing App Router code.

## Changes that need extra care

**Calculation engine** (`backend/domain/calc/`). Bump `ENGINE_VERSION` or `SEC_ENGINE_VERSION`
when any output can change, update the golden tests, and add a `CHANGELOG.md` entry. Old runs
must stay reproducible under their recorded version.

**Methodology packs** (`backend/domain/packs/`). Add a sector by adding a pack, never a sector
branch in the engine or rules. Every rule in a pack needs a clause citation; `loader.test.ts`
enforces it. Bump the pack `version` when its contents change.

**Rules** (`backend/domain/rules/`). Give the rule a stable ID, a clause reference and tests for
each severity. Add it to [`docs/domain/regulatory-register.md`](docs/domain/regulatory-register.md).

**Regulatory values and clause text.** Change these only with a cited source from the domain
reviewer. Record the source in the regulatory register in the same PR. Do not take values from a
language model.

**Database.** Add the next numbered file in `backend/supabase/migrations/`. Never edit an applied
migration. New tenant tables need `organization_id` and RLS policies in the same migration.
Regenerate `backend/lib/supabase/types.ts` when the schema changes.

**AI features.** Every model output is stored as a suggestion, passes a groundedness check in
code, and needs a human decision. Do not remove or bypass a gate.

**Auth and API routes.** Review for capability checks and organisation filters. See
[`SECURITY.md`](SECURITY.md).

## Documentation

- Record significant design choices as an ADR in [`docs/decisions/`](docs/decisions/README.md).
- Keep `docs/architecture/overview.md` true when you change behaviour it describes.
- User-visible and engine changes go in [`CHANGELOG.md`](CHANGELOG.md) under *Unreleased*.

## Windows

The team develops on Windows with PowerShell. Use `curl.exe` rather than `curl` (an alias for
`Invoke-WebRequest`), and prefer the npm scripts over shell one-liners.
