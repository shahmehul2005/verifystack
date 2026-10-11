# Open questions

Decisions and facts only the founders or a domain reviewer can supply. Some block the BPF
submission ([drafted answers](../pitch/bpf2026-answers.md)); some block production. **Do not let
anyone, or any model, invent answers** — fabricated traction or market numbers are what reviewers
probe, and invented regulatory values would put wrong numbers into a compliance product.

When a question is answered, record the answer and date here, and update the code or doc it
affects in the same change.

Status: **Open** · **Partly resolved** · **Resolved**.

## Customer validation

| # | Question | Status |
| - | -------- | ------ |
| 1 | Have you spoken to any verification firm, ACVA or empanelled energy auditor? How many, and can you quote them? Three to five conversations about how they handle normalisation and reproduce old numbers would carry the Problem section. | Open |
| 2 | Is there a signed pilot, LOI, MoU or design partner? Decides whether the milestone answer says "prototype" or "pilot-stage". | Open |
| 3 | Did the meeting with the prospective industry guide happen? What did they say, and can they be named as an advisor? | Open |
| 4 | Any before/after numbers from a real engagement for the "measurable value" answer? | Open |

## Market

| # | Question | Status |
| - | -------- | ------ |
| 5 | How many accredited CVAs and BEE-empanelled energy auditors exist? Needs a citable registry source and an as-of date. | Open |
| 6 | Pricing model — per seat per year, per engagement, or per verified facility — and price point. | Open |
| 7 | Realistic engagement volume per firm per year. With 5 and 6, the only inputs to a bottom-up TAM. | Open |

## Competition

| # | Question | Status |
| - | -------- | ------ |
| 8 | Which competitors do verifiers actually name? Is anyone building specifically for CCTS or ADEETIE verifiers? | Open |

## Roadmap and vision

| # | Question | Status |
| - | -------- | ------ |
| 9 | Business milestones for the next 6–12 months: first paying customer, pilot count, revenue, hires. | Open |
| 10 | Long-term vision: how far beyond CCTS and ADEETIE; whether to move toward the lending and subvention side. | Open |

## Team and programme

| # | Question | Status |
| - | -------- | ------ |
| 11 | Founding team, with roles. | Open |
| 12 | Domain expertise in energy auditing, carbon verification or BEE schemes, and technical background. If it sits with an advisor, name them. | Open |
| 13 | Why BITSoM Vertex, and which single challenge most limits growth now? | Open |
| 14 | Supporting links: deployed app, 3–5 minute demo video (record against a test firm with uploaded sample evidence), website, repository visibility, product documentation, contact details. | Open |

## Regulatory content

These block production and are correctness risks. Values and sources are tracked in the
[regulatory register](../domain/regulatory-register.md).

| # | Question | Status |
| - | -------- | ------ |
| 15 | Who is the domain advisor who signs off `ecm_library` rows? | Open |
| 16 | Which published BEE sector ECM guides are the source (titles, years, sections), and which sectors first? | Open |
| 17 | Should the ECM page be visible before the library is loaded? It currently shows "no matching ECM in library" and no banner, because `ECM_LIBRARY_PRODUCTION_READY` is `true` and the table is empty. Keep, hide behind a flag, or remove from nav? | Partly resolved |
| 18 | Which regulatory documents go into the citation corpus, and where are the files? BEE PAT normalisation pro-formas, CCTS Detailed Procedure for Compliance Mechanism, sector methodology documents, ADEETIE operational guidelines. | Open |
| 19 | Which sector is first for corpus ingestion? Ingest only what the working pack covers. | Open |
| 20 | Is `MIN_RETRIEVAL_COSINE = 0.28` acceptable? Tuning needs about 20 labelled (violation → correct clause) pairs from someone who knows the regulations. | Open |
| 21 | Confirm the ADEETIE scheme thresholds: savings minimum, eligible loan range, debt share, subvention rates, net-rate floor, reimbursement caps. | Open |
| 22 | Does "sustained" savings in M&V have a defined measurement window? None is encoded. | Open |
| 23 | Confirm the notified cluster list and boundaries, so `CLUSTERS_VERIFIED` can be set. | Open |

## Security, operations, deployment

See [`SECURITY.md`](../../SECURITY.md) for the full list of known gaps.

| # | Question | Status |
| - | -------- | ------ |
| 24 | Close self-serve signup for production? Signup now sends an email confirmation through Resend before the account can sign in. Still open: set `AUTH_OPEN_SIGNUP=false` or `AUTH_SIGNUP_ALLOWED_DOMAINS`. | Partly resolved |
| 25 | Which emails go in `VERIFYSTACK_STEWARD_EMAILS`? They are the only people who can verify or correct a reference factor. | Open |
| 26 | Factor re-verification cadence, and who owns it on the platform side? Firms no longer attest factors. | Open |
| 27 | Is Vercel the deployment target, and is the project connected? Needs the environment variables set and the production `/auth/callback` added to Supabase redirect URLs. | Open |
| 28 | Has the repository been pushed? Pushed to `github.com/shahmehul2005/verifystack`, `main`. Decide whether it is public. | Resolved |
| 29 | Make invite links single-use before onboarding a paying firm (SECURITY.md gap 1). | Open |

## Product model

| # | Question | Status |
| - | -------- | ------ |
| 30 | Is the four-role model right for a real firm? Should `firm_admin` be unable to review or run? Does any real firm have one person acting as both lead verifier and independent reviewer? The code forbids it. | Open |

## DFD v3.1 features

Details and the code that holds each default are in the
[regulatory register](../domain/regulatory-register.md) (sections 9 and 10).

| # | Question | Status |
| - | -------- | ------ |
| 31 | Do verifiers need offline capture on site? A small browser queue exists; confirm with users before building more. | Open |
| 32 | Which schemes require an independent technical review, and is the reviewer always the independent reviewer? Decided for now: the same person records the review and signs. | Open |
| 33 | What do the scheme DPR templates require beyond simple payback (NPV, IRR, DSCR, debt-equity) and at what thresholds? | Open |
| 34 | Do bulk-accepted values need a different treatment in any scheme's verification standard? The share is disclosed, not capped. | Open |
| 35 | What is the CCTS annual-cycle stage list? None is defined, so the tracker is ADEETIE only. | Open |
| 36 | Can we get one real SCADA export, one real evidence pack and one portal submission template? Each unlocks an importer or a package format that is generic today. | Open |
| 37 | Single-use response links stop reuse, but anyone who holds the link can answer once. Is that the right trust level for entities, or do they need a one-time code sent separately? | Open |