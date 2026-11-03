<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# VerifyStack repo layout

npm workspaces monorepo with exactly two source workspaces.

| Path        | Contents                                                                                |
| ----------- | --------------------------------------------------------------------------------------- |
| `backend/`  | `@verifystack/backend` — `domain/`, `lib/`, `inngest/`, `fixtures/` (synthetic test data), `scripts/` (CLIs), `supabase/` (SQL + seed) |
| `frontend/` | The Next.js project root — `app/`, `components/`, `lib/`, `public/`, `proxy.ts`           |
| `docs/`     | Architecture, product briefs, operating guides                                            |
| `scripts/`  | Supabase probe and end-to-end smoke scripts (`npm run supabase:probe`, `e2e:*`)           |
| root        | workspace `package.json`, `tsconfig.json` (shared base), `vitest.config.mts`, `eslint.config.mjs`, `.env.example`, CI |

`next dev` regenerates `frontend/AGENTS.md` and `frontend/CLAUDE.md`. This file is not regenerated.

## Import aliases

- Inside `frontend/`: `@/*` → `frontend/*`.
- Anywhere: `@verifystack/backend/*` → `backend/*`.

There is no HTTP hop between the two. The frontend imports backend modules directly;
Next bundles them from source. Both aliases are declared in the tsconfig `paths` of
`backend/tsconfig.json` and `frontend/tsconfig.json`, and mirrored in `vitest.config.mts`.

Server-only backend modules (`lib/supabase/admin.ts`, `lib/supabase/server.ts`, `lib/auth/*`,
`lib/data/*`, `lib/hash.ts`, `domain/extraction/gemini.ts`) start with `import "server-only"`.
Do not import them from a Client Component.

## Commands (run from the repo root)

```bash
npm install
npm run typecheck   # tsc over backend, then frontend
npm test            # vitest, backend + frontend
npm run lint
npm run build
npm run dev
```

## Before you change anything

Read [`docs/architecture/overview.md`](docs/architecture/overview.md) for the system and its
invariants, and [`CONTRIBUTING.md`](CONTRIBUTING.md) for conventions. Design decisions are in
[`docs/decisions/`](docs/decisions/README.md).

## Working agreements

1. **Run the full gate before claiming done:** `npm run typecheck && npm test && npm run lint`.
2. **Code computes; models never do.** No model output may become a number in a calculation.
3. **Never skip a retrieval or groundedness step**, not even for a demo. That shortcut is how a
   hallucinated citation reaches a regulator.
4. **Never widen a capability to make something work.** If a page needs data a role cannot see,
   the design is wrong, not the capability map.
5. **Never edit an applied migration.** Add the next numbered file.
6. **Escalate rather than improvise** on factor values, regulatory text, scheme thresholds or
   engineering advice. Record open items in
   [`docs/domain/regulatory-register.md`](docs/domain/regulatory-register.md).
7. **Ingest only the sectors the working pack covers** into the citation corpus; expand later.
8. **Never commit `.env*` files** other than `.env.example`.
9. The team uses **PowerShell on Windows**. `curl` is an alias for `Invoke-WebRequest`, so use
   `curl.exe`. Use `Move-Item` / `git mv`, not `mv`.
