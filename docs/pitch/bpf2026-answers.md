# BPF2026 / BITSoM Vertex — drafted answers

Source form: `BPF2026-prototype-submission.pdf` in this folder (not committed). The form asks
applicants to *"focus on demonstrating the reasoning behind your decisions rather than making
marketing claims"* and to support answers with evidence, architecture diagrams and screenshots.
These drafts are written from what the code does, so every technical claim can be checked in the
repository.

- **🟢 ready** — grounded in the codebase; usable close to as-is.
- **🟡 needs input** — reasoning drafted; a factual gap only the founders can fill.
- **🔴 founders only** — cannot be drafted from code.

The gaps are listed in [`../product/open-questions.md`](../product/open-questions.md). Do not let
anyone, or any model, fill them with invented traction, market numbers or regulatory values.

---

## Startup snapshot

### What does your startup do? — 🟢 ready

VerifyStack is an operational verification workbench for India's BEE-administered industrial
compliance schemes: CCTS (the Carbon Credit Trading Scheme) and ADEETIE (the energy-efficiency
technology adoption scheme for MSMEs).

We sell only to the **verifier** — Accredited Carbon Verification Agencies and empanelled energy
auditors — and never to the audited entity. That constraint is the product. Our user is a
professional whose signature carries statutory liability, so the software's job is to make their
evidence trail defensible under scrutiny, not to make a facility's numbers look better.

VerifyStack takes a verifier from raw facility evidence (electricity bills, fuel records,
production logs, calibration certificates) to a named, reproducible sign-off. It hashes every
document at intake, requires document, page, bounding box and source text on every extracted
number, computes the regulated metric in a pure versioned engine, and hash-chains every
calculation run so a result from a year ago can still be re-derived.

### What milestone best represents your progress? — 🟡 needs input

**Working end-to-end product with the full regulated pipeline implemented, pre-first-customer.**

Built and tested:

- All **9 CCTS sectors** and all **14 ADEETIE Phase-1 sectors** as runnable methodology packs.
- The full P1→P7 pipeline: engagement setup, hashed evidence intake, Gemini extraction with
  provenance validation, a human review gate, hash-chained calculation runs, findings with
  severity, and split lead / independent sign-off.
- The ADEETIE IGEA → DPR → M&V lifecycle with eligibility rules.
- Four-role access control with structural maker–checker separation.
- Two AI features with programmatic groundedness gates (regulatory citations, ECM suggestions).
- Firm onboarding: self-serve signup with email confirmation, signed invites, team management.
- 276 automated tests over units, factors, engines, rules, packs, citations, ECM and auth.

Not yet done: the regulatory corpus and ECM library are not loaded with real publications, and
reference values are awaiting domain review (see the
[regulatory register](../domain/regulatory-register.md)).

> **Input needed:** do you have a signed pilot, LOI or design-partner conversation with a
> verification firm? That single fact moves this answer from "prototype" to "pilot-stage".

---

## Problem understanding

### What problem are you solving, and who experiences it most acutely? — 🟢 ready

India has made industrial carbon and energy compliance **mandatory and auditable**, but the
verification layer that must certify it still runs on spreadsheets and email.

The acute sufferer is the **verifier**, not the factory. A verifier signs a statement that a
facility's emission or energy intensity is accurate. That signature carries professional and
statutory liability, and today it rests on:

- numbers retyped by hand from PDF bills and logs into Excel, with no link back to the source page;
- sector-specific normalisation rules applied from memory or a colleague's old workbook;
- emission and energy factors of uncertain vintage, with no record of who checked them or when;
- a calculation that cannot be reproduced later, because the workbook has since been edited.

So the problem is **defensibility, not arithmetic**. When a regulator, a credit buyer or a lender
questions a number years later, the verifier often cannot reconstruct how it was derived, what
evidence supported it, or which version of which rule applied. That is career and licence risk,
and a spreadsheet cannot solve it.

A secondary sufferer is the **audited enterprise**, particularly ADEETIE MSMEs, because slow
verification and rework delay their access to interest subvention on efficiency loans.

### What evidence validates that this problem is worth solving? — 🟡 needs input

The structural evidence:

- Verification is a legal precondition, not a nice-to-have: CCTS requires *accredited* agencies,
  and ADEETIE requires audits by *empanelled* auditors.
- ADEETIE runs three sequential phases (IGEA → DPR → M&V) with a money gate: interest subvention
  depends on the DPR, and M&V must show savings achieved and sustained. A weak audit trail blocks
  disbursement directly.
- Verifier capacity is the bottleneck, not demand. The accredited and empanelled pool is small and
  fixed by accreditation; the obligated population is large. Raising throughput per verifier has
  outsized value.
- Normalisation is sector-specific, which is why every rule in our packs must carry a clause
  citation: a verifier cannot defend a normalisation they cannot cite.

> **Input needed — the biggest gap in the submission.** The form asks for customer insight and
> evidence. Three to five recorded conversations with verifiers, quoted, would transform this
> answer.

---

## Customer and market

### Who is your ideal customer, and who makes the buying decision? — 🟢 ready

**Ideal customer:** a small-to-mid Accredited Carbon Verification Agency or BEE-empanelled energy
audit firm, roughly 5–40 professionals, running several engagements across sectors at once. Large
enough to feel the coordination and defensibility pain; too small to build internal tooling.

**Decision maker:** the firm's **partner or lead verifier**, the person who signs and carries the
liability. The economic buyer and the liability bearer are the same person, and the pain is theirs.

We designed for this. The role model separates `firm_admin` (team and audit log) from
`lead_verifier` (the verification lifecycle and sign-off). The admin manages people and the audit
log but cannot review evidence, run calculations or sign, because the signer and the office
manager are different people with different needs.

**Not the customer:** the audited entity. Selling to both sides would compromise the independence
that makes a verifier's signature worth anything.

### How large is the opportunity? — 🟡 needs input

The bottom-up structure:

```
  number of accredited CVAs + empanelled energy auditors in India
× seats per firm, or engagements per firm per year
× price per seat per year, or per engagement
= addressable revenue
```

Each input needs a real source, and none is in the codebase, so any figure drafted here would be
invented.

What can be said without them: the market is **created and gated by regulation**. The number of
firms permitted to do this work is set by accreditation and empanelment, so the customer list is
finite and publicly knowable from BEE registries. The TAM can be counted, not estimated.

---

## Solution overview

### What is your solution, and how does it solve the problem? — 🟢 ready

VerifyStack is built on one inversion of the usual AI product logic: **code computes; models
never do.**

The calculation engine is pure, deterministic and versioned. A language model never performs
arithmetic, derives a factor, or produces a number that reaches a result. Models only read
documents, explain retrieved source text, and draft prose, and every output is stored as a
suggestion that a named person must accept, edit or reject.

| Verifier's problem                     | How VerifyStack removes it |
| -------------------------------------- | -------------------------- |
| Numbers retyped with no link to source | No value without provenance: document, page, bounding box and verbatim text, or the value is dropped to the audit log |
| Normalisation applied from memory      | Methodology packs are data, not code paths; a runnable pack whose rules lack clause citations is rejected |
| Factors of unknown vintage             | Every factor carries a source and vintage; only a platform steward can verify it, and every run lists each unverified factor it used |
| Result cannot be reproduced later      | Every run records engine version, pack version and input hash, and is hash-chained to the previous run |
| Signature risk concentrated in one person | Maker–checker is structural: lead and reviewer sign-off belong to different roles, and one person cannot sign both |
| Citation risk from AI                  | Retrieval, not recall, with a code-level gate that rejects any citation the model was not given |

### What are the core capabilities? — 🟢 ready

1. **Methodology packs as data.** 9 CCTS sectors (GEI) and 14 ADEETIE Phase-1 sectors (SEC), all
   runnable. A new sector never adds a branch to the engine. A database trigger
   (`engagements_forbid_pack_rebind`) stops an engagement's methodology being swapped afterwards.
2. **Hashed evidence intake.** Files are SHA-256 hashed, stored privately under their hash, and
   served only through an authenticated route.
3. **Provenance-gated extraction.** Gemini proposes field values; anything without document, page,
   bounding box and source text is discarded to the audit log.
4. **Human review gate.** High-materiality fields always need a named reviewer.
5. **Deterministic, versioned calculation** with golden tests, plus reconciliation rules with
   `block | warn | info` severity. An open `block` finding stops sign-off and ADEETIE phase
   advance.
6. **Hash-chained calculation runs** for permanent reproducibility.
7. **Regulatory Citation Assistant.** Retrieves the applicable clause from an ingested corpus with
   pgvector, filtered by scheme and sector before similarity search, and rejects any citation
   outside the retrieved set.
8. **ECM suggestions.** Deterministic matching against a curated library; a model may only reword
   a matched row's own fields.
9. **ADEETIE lifecycle.** IGEA → DPR → M&V, strictly sequential, each phase a full verification
   cycle, with eligibility rules for enterprise category, cluster proximity, loan size, debt share
   and subvention rate.
10. **Capability-based access control** across four roles, one source of truth for nav, pages and
    APIs.
11. **Complete audit trail.** Append-only `audit_events` plus `ai_action_logs`, so every AI action
    is itself auditable.
12. **Platform-owned reference factors.** Published factor values are maintained by a platform
    steward with a citation, not by each firm.

### What measurable value does it deliver? — 🟡 needs input

The mechanisms:

- **Rework avoided.** Reconciliation rules catch an incomplete baseline year or a non-closing
  energy balance before a report is issued, not after a regulator returns it.
- **Time to defend a past number.** Reconstructing a year-old result goes from searching email and
  workbook versions to opening a hash-chained run.
- **Throughput per verifier.** Provenance-gated extraction removes manual retyping, the bottleneck
  in a capacity-constrained profession.
- **Citation risk removed by construction.** A hallucinated clause cannot reach the verifier,
  because the gate is code, not a prompt instruction.

> **Input needed:** before/after numbers from one real engagement ("baseline reconciliation took
> six days, now two") will outweigh any projection.

---

## Technology and AI architecture

### Architecture, data flow and major components — 🟢 ready

> Attach [`../architecture/data-flow.md`](../architecture/data-flow.md) and a screenshot of the
> findings screen with the citation panel open.

**Shape.** One Next.js application in an npm workspaces monorepo with two workspaces and **no HTTP
hop between them**. `frontend/` holds pages and route handlers; `backend/` holds the domain model,
data access, background jobs and schema. The frontend imports backend modules directly. This
removes a network boundary, keeps the domain layer unit-testable on its own, and keeps one type
system across the stack.

**Stack.** Next.js 16 · TypeScript · Supabase (Postgres, Auth, Storage) · pgvector · Inngest ·
Gemini · Zod at every trust boundary · Vitest.

**Data flow, P1 → P7:**

```
P1  Engagement & pack setup    → engagement bound immutably to a methodology pack
P2  Evidence intake            → hashed upload → private storage + document pages
P3  Extraction (Gemini)        → extracted fields, each with document/page/bbox/source text
                                 ⤷ no provenance → dropped to the audit log, never a fact
P4  Human review               → reviewer accepts / edits / rejects → facts ledger
P5  Calculation run            → pure engine reads facts through pack bindings
                                 ⤷ unverified factor → listed as a warning on the run
                                 ⤷ records engine version, pack version, input hash; chained
P6  Findings                   → reconciliation rules → block | warn | info
                                 ⤷ governing clause retrieved and checked   (gated)
                                 ⤷ CAR wording drafted from a template      (gated)
P7  Sign-off                   → lead verifier and independent reviewer, different people
                                 ⤷ any open block finding prevents sign-off
```

**Data.** Eleven ordered migrations. Core tables: `organizations`, `memberships`,
`methodology_packs`, `engagements`, `documents`, `document_pages`, `extraction_jobs`,
`extracted_fields`, `facts`, `calculation_runs`, `findings`, `signoffs`, `factor_records`,
`audit_events`, `ai_action_logs`; then `sec_runs`, factor verification, `adeetie_clusters`,
`adeetie_measures`, `regulatory_documents` / `regulatory_chunks` and `ecm_library`.

**Multi-tenancy.** Every tenant table carries `organization_id` with Row Level Security policies
on `is_org_member()`. Route handlers resolve the user's organisation from the session and scope
every query to it. Moving all read paths onto the session client, so RLS is enforced on every
request as well, is on the hardening list.

**Graceful degradation.** The app boots with no environment variables. Without Supabase, marketing
pages load and the app shows a configuration notice. Without `GEMINI_API_KEY`, extraction returns
a clean 503, CAR drafting falls back to the grounded template, and citations report `unavailable`
rather than guessing.

### What role does AI play? — 🟢 ready

**Our most differentiated answer: the role is deliberately narrow.**

| Workflow | What the model does | The hard constraint |
| -------- | ------------------- | ------------------- |
| **Extraction** (P3) | Proposes field values from bills, logs, certificates | Every value needs document, page, bounding box and verbatim source text; otherwise it is dropped to the audit log |
| **Regulatory citation** (P6) | Explains why a *retrieved* clause applies | Filter by scheme and sector, then vector similarity, then pass only retrieved text. After generation, code checks every citation is in a chunk that call received; otherwise reject and route to a person |
| **Prose drafting** (P6, ECM) | Rewords a CAR or a matched ECM row | May add no equipment, number or claim absent from the source; otherwise the raw text is shown |

**What AI never does, by construction:** arithmetic, factor derivation, any number that reaches a
result, or auto-acceptance. Every output starts as a suggestion.

Three choices we want reviewers to notice:

1. **Groundedness gates are code, not prompts.** "The system prompt said not to hallucinate" is not
   a control. The citation feature returns one of four states — `grounded`, `rejected`,
   `no_applicable_clause`, `unavailable` — and only `grounded` output reaches the verifier.
   Adversarial tests check that a finding with no matching clause returns "no applicable clause
   found" rather than a forced citation.
2. **We constrain the model where the stakes are physical.** ECM matching is deterministic
   filtering and ranking with no model in the path, because a fabricated engineering intervention
   has real safety and cost consequences. The library is loaded only from a published BEE guide
   reviewed by a domain advisor; until then the module says "no matching ECM in library" rather
   than suggesting something plausible and wrong.
3. **AI actions are audited.** `ai_action_logs` and versioned prompt identifiers let us answer
   "what did the model see, and which prompt produced this?" months later.

---

## Competitive advantage

### What alternatives exist, and how do you compare? — 🟡 needs input

| Alternative | Where it falls short for a verifier |
| ----------- | ----------------------------------- |
| **Excel and email** (the real incumbent) | No link to source pages, no reproducibility once edited, no maker–checker, no factor vintage record |
| **Global ESG / carbon accounting platforms** | Built for the reporting entity to compute its own footprint, not for an independent verifier to challenge it; no CCTS or ADEETIE methodology; wrong side of the independence line |
| **Generic document-AI tools** | Extract fields but carry no methodology, reconciliation, clause citation or sign-off; they solve one step of seven |
| **In-house spreadsheets plus a developer** | Breaks down across 23 sector methodologies; no hash-chained audit trail |
| **A general LLM assistant** | Recalls regulations from training data — the failure the citation gate exists to prevent |

> **Input needed:** the competitors verifiers actually name, and any tool already in use at firms
> you have spoken with.

### If a foundation-model provider shipped this tomorrow, why do you still win? — 🟢 ready

A model provider ships **capability**, and very little of our product is capability.

1. **Our value is in refusal, not generation.** A better model makes hallucinations more fluent and
   more dangerous. Filtering, retrieving and rejecting any citation outside the retrieved set is a
   control system around a model, and it becomes more valuable as models become more persuasive.
2. **The regulated system of record is not a model feature.** Hash-chained runs, pack binding
   enforced by a database trigger, organisation-scoped tenancy, structural maker–checker,
   provenance-or-discard and platform-owned reference factors are what make a signature
   defensible.
3. **23 sector methodologies encoded as data.** Nine CCTS GEI packs and fourteen ADEETIE SEC
   packs, each with stream and energy bindings, reconciliation rules and a clause citation on every
   rule. This deepens with each engagement.
4. **The scheme lifecycle is the moat.** ADEETIE's IGEA → DPR → M&V sequence, its subvention gate
   and its eligibility rules are workflow modelling of an Indian regulatory scheme.
5. **We swap the model.** `GEMINI_MODEL` is configuration. A better, cheaper model is an upgrade we
   absorb, not a competitor.
6. **Trust and independence compound.** We sell only to verifiers. Once established with
   accredited firms, that position is not one a model provider can occupy.

**In short:** a smarter model improves the generation step, and the generation step is the part of
our product we deliberately trust least.

---

## Vision and roadmap

### Next major product and business milestones — 🟡 needs input

Product milestones, already flagged in the code:

1. **Load the real regulatory corpus.** Today's corpus is a synthetic Foundry and Cement set.
   Production needs the BEE PAT normalisation pro-formas, the CCTS Detailed Procedure for
   Compliance Mechanism, sector methodology documents and the ADEETIE operational guidelines; then
   tune the retrieval threshold against labelled violation-to-clause pairs.
2. **Load and review `ecm_library`** from a published BEE sector ECM guide, signed off by a named
   domain advisor.
3. **Verify reference data**: scheme thresholds, clause references, cluster list and factors, per
   the regulatory register.
4. **Pilot hardening**: close open signup, make invites single-use, add rate limiting (see
   [`SECURITY.md`](../../SECURITY.md)).
5. **Production deployment** with environment variables set and the production auth callback
   registered.
6. **One real engagement end to end** with a design-partner firm.

> **Input needed:** business milestones — first paying firm, pilot count, revenue, hiring,
> accreditation relationships.

### Long-term vision — 🔴 founders only

A direction the architecture supports, if it matches your intent: VerifyStack becomes the **system
of record for regulated industrial verification in India**, where a defensible number is produced
and where a regulator, lender or credit buyer can trace any published figure to a hashed source
page. Because packs are data, new schemes are new data, not new products. ADEETIE's money gate
points to an adjacency (lenders and subvention administrators consuming verified outputs). The
ambition, sequencing, and whether to move toward the lending side are founder decisions.

---

## Team · Why BITSoM Vertex · Supporting material — 🔴 founders only

See [`../product/open-questions.md`](../product/open-questions.md).
