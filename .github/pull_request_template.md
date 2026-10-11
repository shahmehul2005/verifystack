## What and why

<!-- One or two sentences. Link the issue or open question if there is one. -->

## How it was tested

<!-- Commands run, screens checked, roles signed in as. -->

## Checklist

- [ ] `npm run lint && npm run typecheck && npm test && npm run build` pass
- [ ] Engine output can change → `ENGINE_VERSION` / `SEC_ENGINE_VERSION` bumped, golden tests updated
- [ ] Pack contents changed → pack `version` bumped
- [ ] Schema changed → new numbered migration (no applied migration edited), `types.ts` regenerated
- [ ] Regulatory value or clause changed → source recorded in `docs/domain/regulatory-register.md`
- [ ] New route handler → capability check and organisation filter
- [ ] No model output reaches a calculation; no groundedness gate removed
- [ ] `docs/architecture/overview.md`, ADRs and `CHANGELOG.md` updated where behaviour changed
