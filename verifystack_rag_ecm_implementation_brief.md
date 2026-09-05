# VerifyStack — Implementation Brief: Regulatory Citation Assistant & ECM Recommendation Module

Paste this whole document as your first message to the coding agent working on this. It assumes the agent has repo access and has already read `AGENTS.md`/`README.md` and the existing domain layer (`units.ts`, `calc/engine.ts`, `rules/rules.ts`, the extraction and findings-drafting modules). If it hasn't, tell it to read those first — this brief builds directly on that existing architecture and repeats none of it.

Both features below must obey the project's existing non-negotiables: **AI never computes, only retrieves and drafts. Every AI output is created in a `suggested` state requiring human accept/edit/reject. Every AI-generated claim must be traceable to a specific, real source record — if it can't cite one, it must refuse rather than invent one.** Build both features to fail loudly (reject/flag) rather than silently produce ungrounded output.

---

## Feature 1 — Regulatory Citation Assistant (retrieval, not recall)

### Goal
When a reconciliation rule fires or a calculated value needs justification (e.g. a normalization adjustment, an exclusion, a clause-based finding), retrieve the exact applicable regulatory text — instead of letting a model recall it from training data, which risks a plausible-sounding but wrong citation.

### Data model
Add two tables (Postgres + `pgvector` extension — don't introduce a separate vector database; we already run Postgres and this avoids new infra):

```sql
CREATE TABLE regulatory_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,                  -- e.g. "PAT Normalization Guidelines — Cement, Cycle III"
  scheme TEXT NOT NULL,                 -- 'PAT' | 'CCTS' | 'ADEETIE'
  sector_or_cluster TEXT,               -- e.g. 'Cement', nullable for scheme-general docs
  source_url TEXT NOT NULL,
  effective_date DATE,                  -- regulations change; track this
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  raw_file_hash TEXT NOT NULL           -- detect if source doc has changed since ingestion
);

CREATE TABLE regulatory_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES regulatory_documents(id),
  clause_ref TEXT,                      -- e.g. "Para 4.2(b)" if extractable, else null
  page_number INT,
  chunk_text TEXT NOT NULL,             -- verbatim source text, no paraphrasing at ingest time
  embedding VECTOR(1536)                -- match to whichever embedding model you pick
);
```

### Ingestion pipeline
1. Source documents: BEE's PAT general + sector-specific normalization pro-formas, CCTS's Detailed Procedure for Compliance Mechanism + sector methodology documents, ADEETIE operational guidelines. Start with only the sectors/clusters in your current demo pack — don't ingest all 9 CCTS sectors' documents on day one.
2. Chunk by clause/section boundary where the document structure allows it, not fixed character counts — a clause split mid-sentence is useless for citation. Target roughly 300–600 tokens per chunk with light overlap.
3. Store the **verbatim** source text in `chunk_text`. Never paraphrase at ingestion time — paraphrasing here is exactly the kind of drift that breaks traceability later.
4. Generate embeddings (reuse whatever embedding model is cheapest/most consistent with your existing Gemini integration, or a dedicated embedding model — pick one and be consistent, since mixing embedding models breaks similarity search).
5. Tag every chunk with `scheme` and `sector_or_cluster` at ingestion time — this lets retrieval filter by the active methodology pack before doing similarity search, which matters a lot given how sector-specific normalization is.

### Retrieval + generation flow
1. Trigger: a reconciliation rule fires, or a calculated value shows a deviation worth explaining (hook this into the existing findings-generation step, immediately before the AI drafts finding language).
2. Filter `regulatory_chunks` by the active engagement's `scheme` + `sector_or_cluster` (from the methodology pack), then run vector similarity search against the rule/deviation description to get the top 3–5 candidate chunks.
3. Pass **only the retrieved chunk text** (with document title, clause ref, page) into the drafting LLM call, with an explicit system instruction: *"Only cite clauses present in the provided context. If none of the provided chunks clearly apply, say so explicitly — do not cite anything else."*
4. **Validation gate, non-negotiable:** after generation, programmatically check that every citation string the model output actually appears in (or is a close match to) one of the chunks it was given. If it cites anything outside the retrieved set, reject the output and route to human review with no citation attached, rather than surfacing an unverifiable one. This mirrors the provenance-validation gate already used in extraction — reuse that pattern rather than writing a new one.

### UI requirement
The auditor must see, side by side: the retrieved clause's exact text, its source document and page, and the AI's proposed explanation of why it applies — with accept/edit/reject, same interaction pattern as the existing findings review screen.

### Tests to write
- A small labeled set of (rule violation → expected clause) pairs per ingested sector, checked for retrieval recall.
- An adversarial test: feed a rule violation with **no** matching chunk in the corpus, and assert the system explicitly returns "no applicable clause found" rather than forcing a citation.
- A groundedness test: assert every citation in generated output text-matches a chunk that was actually retrieved for that call.

---

## Feature 2 — ECM Recommendation Module (curated library, not free generation)

### Goal
Suggest relevant Energy Conservation Measures (ECMs) for a facility, without letting an LLM invent an engineering intervention from scratch — a fabricated recommendation here carries real safety/cost consequences, unlike a fabricated sentence in a findings draft.

### Data model

```sql
CREATE TABLE ecm_library (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scheme TEXT,                          -- nullable; some ECMs are scheme-agnostic
  sector_or_cluster TEXT NOT NULL,
  equipment_tag TEXT NOT NULL,          -- e.g. 'induction_furnace', 'boiler', 'compressed_air'
  ecm_name TEXT NOT NULL,
  description TEXT NOT NULL,
  typical_savings_range TEXT,           -- e.g. "5-12% of related SEC"
  typical_payback_months INT,
  source_reference TEXT NOT NULL,       -- e.g. "BEE Cement Sector ECM Guide, 2023, Sec 3.1"
  source_url TEXT
);
```

**Do not seed this table by asking an LLM to generate ECMs.** Populate it from BEE's own published sector ECM guides and, ideally, validated against a real domain advisor or auditor before anything in it is shown to a user — this table is the single point where a wrong entry could cause real-world harm, so treat populating it as a research task, not a scripting task.

### Matching logic — deterministic, not generative
1. From the facility's extracted equipment list and the calculated SEC/GEI gap versus the sector benchmark, generate a set of `equipment_tag` matches (plain filtering/tagging logic — no LLM involved in this step).
2. Query `ecm_library` for rows matching `sector_or_cluster` + any matched `equipment_tag`, rank by estimated relevance (e.g. proximity of facility's benchmark gap to the ECM's typical savings range).
3. The LLM's only role here is to turn the matched row's own fields into a readable sentence for the auditor — e.g. "Based on your induction furnace usage, consider: {ecm_name} — {description} (typical savings {typical_savings_range}, source: {source_reference})." **The model must not add any technical detail not present in the row.** Enforce this the same way as Feature 1: validate that the generated text doesn't introduce equipment, numbers, or claims absent from the source row; reject and fall back to showing the raw row unstyled if it does.

### UI requirement
Every suggested ECM shown must display its `source_reference` visibly, not just in a tooltip — this is a recommendation with real cost implications, and the auditor needs to be able to independently verify it, not just trust the app.

### Tests to write
- Matching-logic unit tests: given a known equipment/gap profile, assert the expected `ecm_library` rows are returned, using fixture data, no LLM in the test path.
- A groundedness test identical in spirit to Feature 1's: generated ECM text must not introduce any fact absent from its source row.
- An empty-match test: if no `ecm_library` row matches, the module must say so plainly rather than the LLM improvising a suggestion outside the library.

---

## Sequencing

Build Feature 1 first — it reuses infrastructure you already have (the pack/citation pattern from findings generation) and carries materially lower risk. Do not start on Feature 2's matching logic until `ecm_library` has been populated and reviewed by a real domain source (a firm you're talking to, or an advisor) — an empty or thinly-populated, unverified ECM library is worse than not shipping the feature yet, since a sparse table will silently produce weak or missing suggestions that look complete.

## What NOT to do while building this

- Don't let either feature's LLM call skip the retrieval step "just this once" for a demo — that's exactly the shortcut that produces a hallucinated citation or a fabricated ECM in front of a judge or a real auditor.
- Don't ingest all 9 CCTS sectors' documents before the demo — ingest only the sector(s) your working pack actually covers, and expand later.
- Don't treat `ecm_library` seeding as a coding task you can finish alone — flag back to the founder if you're about to populate it without a domain-verified source, per the escalation rule in the main handoff doc.
