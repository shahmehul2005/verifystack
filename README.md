# VerifyStack

Operational verification workbench for India's BEE-administered compliance schemes —
CCTS (Accredited Carbon Verification Agencies) and ADEETIE (empanelled energy auditors).

Built for the **verifier's** side of the workflow. VerifyStack is never sold to the
audited entity.

## Status

Prototype. The deterministic core (units, factors, calculation engine, reconciliation
rules) is implemented and tested. The extraction layer is scaffolded against Gemini.
UI is not built yet.

## Design rules

These are not style preferences. They are the reason a verifier can defend an output.

1. **Code computes, models never do.** The calculation engine is pure, versioned, and
   deterministic. A language model may help decide which method applies; it never
   performs arithmetic.
2. **No value without provenance.** Every extracted fact carries a document, page,
   bounding box, and the verbatim source text. Values lacking provenance are rejected
   at the boundary, which is what makes "click any number to see its source" an
   invariant rather than a feature.
3. **AI proposes, humans decide.** Every model output enters in a `suggested` state and
   requires a named human to accept or reject. Nothing is auto-approved.
4. **Reproducible forever.** Every calculation records engine version, factor set
   version, and a stable hash of its inputs. A number computed today must be
   reproducible during a technical review years later.
5. **Unverified factors are refused.** Reference factors carry a `verified` flag.
   The engine will not run with unverified factors unless explicitly in draft mode.

## Layout

```
src/domain/
  units.ts              Dimension-checked quantities. Cross-dimension conversion throws.
  factors.ts            Emission factors, CV defaults, plausibility ranges, sampling mandates.
  calc/engine.ts        Deterministic emissions + GEI calculation with derivation trails.
  rules/types.ts        Reconciliation context and finding shapes.
  rules/rules.ts        Eight reconciliation checks (MB001, CV001/002, LB001, TS001,
                        EF001, SM001, MT001).
  extraction/schemas.ts Zod schemas with mandatory provenance + confidence triage.
  extraction/provider.ts Provider-agnostic interface and cross-check helper.
  extraction/gemini.ts  Gemini adapter with prompt-injection isolation and JSON validation.
```

## Reference data must be verified before use

`src/domain/factors.ts` currently ships **placeholder** values marked
`verified: false` — CEA grid factors and IPCC fuel factors included. These exist so the
engine runs during development. Before any output is shown to a verifier, each value
must be read from its published source and the flag flipped.

This is deliberate: shipping an unchecked emission factor is precisely the class of
error this product exists to catch.

Clause references in `rules.ts` marked `TO VERIFY` need checking line-by-line against
the gazetted CCTS Detailed Procedure.

## Getting started

```bash
npm install
npm test          # 38 tests across units, engine, rules
npm run dev       # Next.js dev server
npx tsc --noEmit  # typecheck
```

Copy `.env.example` to `.env.local` and add a Gemini API key to use extraction.

## What is deliberately not built yet

Multi-scheme config engine, workflow state machine, management dashboards, ICM portal
integration, e-signature, notifications, admin config UI, maker-checker sign-off, and
the offline field-capture app. All are real requirements; none belong in the prototype.
