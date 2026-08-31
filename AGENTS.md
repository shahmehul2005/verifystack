<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# VerifyStack repo layout

npm workspaces monorepo with exactly two source workspaces.

| Path        | Contents                                                                                |
| ----------- | --------------------------------------------------------------------------------------- |
| `backend/`  | `@verifystack/backend` — `domain/`, `lib/`, `inngest/`, `demo/`, `supabase/` (SQL + seed) |
| `frontend/` | The Next.js project root — `app/`, `components/`, `lib/`, `public/`, `proxy.ts`           |
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
