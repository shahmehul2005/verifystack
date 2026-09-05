# Advisory for you (founder / platform steward)

This is the operating checklist after the prototype was stripped of demo chrome. Do this in
order. The auditor advisory is `ADVISORY_AUDITOR.md` — send them that file, not this one.

---

## Why firms no longer see factor verification

A firm typing its own factor and calling it “verified” would let the engine accept whatever
number the answer needs. CEA’s grid factor and IPCC Table 2.2 are the **same published
number for every customer**. That is platform work.

| Who | What they do |
| --- | --- |
| **You** (email in `VERIFYSTACK_STEWARD_EMAILS`) | Open **Factors** (only you see it). Cite the publication. Correct the value if the shipped figure is wrong. |
| **Firm lead / verifier / admin** | Do not see Factors in the nav. They upload evidence, review, run, decide findings, sign off. |

Verification is still **stored per organisation**. After you cite factors, those citations
apply to **the org you are signed into**. If you later create a second client org, sign in
there as steward and repeat, or tell me and we can make catalogue updates global.

---

## Today — factors (you)

1. Confirm `frontend/.env.local` has your email:

   ```
   VERIFYSTACK_STEWARD_EMAILS=you@yourfirm.com
   ```

2. Restart `npm run dev`.
3. Sign in with that email as **lead verifier**.
4. Open **Factors**. For each unverified row, paste a real citation (≥12 characters, no
   `TO VERIFY` leftover), e.g. `CEA CO2 Baseline Database v20.0, Table A, FY2024-25`.
5. If the shipped number is wrong, enter the published value in the correction field.
6. Re-run calculation on an engagement so it picks up the new set.

Sources to have open: CEA CO₂ Baseline Database; IPCC 2006 Vol.2 Table 2.2; IPCC 2006 Vol.3
(process); BEE General Guidelines for Energy Audit conversion table.

---

## Today — turn off leftover draft-mode rows

New engagements are created live. Old ones may still have `draft_mode = true` in the database
(the toggle is gone from the UI). In the Supabase SQL editor:

```sql
update public.engagements set draft_mode = false;
```

Runs no longer refuse unverified factors. Still cite them so the working paper is honest.

---

## Citations — replace the synthetic ingest

You already loaded **2 synthetic documents / 15 chunks**. Those must not be shown to a client
as law.

In Supabase SQL editor, **after** you have the real PDFs ready to ingest:

```sql
delete from public.regulatory_chunks;
delete from public.regulatory_documents;
```

Then ingest **verbatim** official text, tagged with scheme + sector. The existing ingest
pipeline (`backend/domain/citations/ingest.ts`) is the path; the demo CLI currently loads the
synthetic corpus only. When you have real files, send them (or paths) and we wire a real-PDF
ingest. Do not dump random web pages. Do not ingest all nine CCTS sectors yet — Foundry +
Cement first, as the auditor prioritises.

Until real docs are in, citation panels may still show the synthetic clauses you ingested.
Delete them before a client sitting if the auditor has not replaced them.

**You do not need Pinecone or another vector database.** Citations use `pgvector` in the
same Supabase Postgres. ECM is a normal table, not vectors.

Keep **Gemini** (`GEMINI_API_KEY`) for embeddings and extraction.

---

## ECM — empty table is correct

`ecm_library` is empty until the auditor’s signed spreadsheet is loaded. The UI will say
**no matching ECM in library**. That is the honest state.

Do **not** paste ChatGPT measures. When the sheet arrives, we insert rows (service role) and
matching starts. Groundedness still rejects a styled sentence that adds facts not on the row
— that is the product, not a demo banner.

---

## How a client uses the product now

1. Sign in → create engagement (CCTS or ADEETIE pack).
2. Documents → upload → extract → workbench accept.
3. Facts ledger shows accepted values only.
4. Calculation → run (lead verifier).
5. Findings → accept / edit / reject citations and CARs.
6. ECM suggestions if the library has rows for that sector.
7. Sign-off: lead and independent reviewer are different people.

There is no draft-mode button, no “load synthetic facts”, no public Aravalli demo (`/workbench`
redirects to login).

---

## What I kept on purpose (do not ask to remove these)

- **Groundedness gates** on citations and ECM styling — without them a model can invent a
  clause or a measure. That is the pitch, not a warning sticker.
- **Accept / edit / reject** on AI output.
- **Provenance** (document, page, bbox, source text) or the value is dropped.
- **RBAC** and maker–checker sign-off.
- **Unit tests** — they are not shown to clients.

---

## Pitchfest / client checklist

- [ ] Steward emails set; factors cited on the demo org  
- [ ] Old engagements `draft_mode = false`  
- [ ] Synthetic citation rows deleted **or** replaced with real PDFs  
- [ ] Auditor punch list from one Foundry + one Cement walkthrough  
- [ ] ECM sheet received before you claim “ECM recommendations” on stage  
- [ ] Production `/auth/callback` on Supabase if you deploy  
- [ ] SMTP / `AUTH_OPEN_SIGNUP=false` before real customers create accounts  

When the auditor sends PDFs + the ECM sheet, we ingest and seed. Do not skip them and
improvise content.
