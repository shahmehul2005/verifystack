# 0002. One application in two workspaces

- Status: Accepted
- Date: 2026-08-31

## Context

The domain logic (units, engines, rules, packs) must be unit-testable without a web server, and
the team is small. A separate backend service would add a network boundary, a second deploy, a
second set of types and an internal API to keep in sync.

## Decision

The repository is an npm workspaces monorepo with `backend/` (`@verifystack/backend`) and
`frontend/` (the Next.js app). The frontend imports backend modules directly; Next bundles them
from source. There is no HTTP call between the two. Route handlers in `frontend/app/api/` are
the only server entry points.

## Consequences

- One deploy, one type system, no internal API contract to version.
- Domain code is tested directly with Vitest.
- Server-only backend modules must start with `import "server-only"` so they cannot leak into a
  Client Component bundle.
- Path aliases must stay in sync across `backend/tsconfig.json`, `frontend/tsconfig.json` and
  `vitest.config.mts`.
- If a separate API is ever needed (for example for a lender integration), it will be a new
  decision.
