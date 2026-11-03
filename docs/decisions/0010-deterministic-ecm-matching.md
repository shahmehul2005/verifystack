# 0010. Deterministic ECM matching

- Status: Accepted
- Date: 2026-09-05

## Context

An energy conservation measure is engineering advice with cost and safety consequences. A model
that generates or embellishes measures can recommend something that does not apply to the plant.

## Decision

ECMs come only from `ecm_library`, populated from a published BEE sector guide reviewed by the
domain reviewer. Matching is plain code (`backend/domain/ecm/match.ts`): sector, equipment tags
derived from the pack's stream IDs, and the plant's intensity gap against each row's typical
savings range. A model may reword a matched row; `style.ts` rejects any wording that adds
equipment, numbers or claims not on the row and shows the raw row instead. No match returns
"no matching ECM in library". The source reference is always visible.

## Consequences

- No suggestion can appear without a citable source row.
- The feature shows nothing until the library is loaded, and that empty state is correct.
- Coverage grows only as fast as reviewed library rows are added.
