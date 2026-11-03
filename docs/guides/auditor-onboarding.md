# Advisory for the BEE-empanelled energy auditor

You are the domain reviewer for VerifyStack — not a software engineer. Your name sits on the
regulatory corpus and the Energy Conservation Measure (ECM) library. Please do not invent
clauses or measures, and do not ask a language model to write them.

The product already computes. Your job is to feed it **published sources** and to test that
the pipeline matches how you would actually verify a facility.

---

## 1. What you are signing

| Workstream | What “done” means |
| --- | --- |
| **Regulatory citations** | Real BEE / CCTS / ADEETIE PDFs ingested as verbatim text. A finding cites a clause that actually exists in those files. |
| **ECM library** | Rows in `ecm_library` taken from a published BEE sector ECM guide, with a source you would put on a working paper. |
| **Scheme thresholds** | Confirm ADEETIE 10% savings, loan band, 75% debt, 200 km cluster, 5% / 3% subvention against the **current** operational guidelines. |
| **Product test** | Walk one Foundry (ADEETIE) and one Cement (CCTS) engagement end to end and write a punch list. |

You do **not** change catalogue factor *values*. That is the platform team’s job. If a shipped
CEA / IPCC / BEE conversion figure looks wrong, email the founder with the publication, table,
and the number you read.

---

## 2. How to test the product (day one)

Sign in as **lead verifier** (a second person as independent reviewer for sign-off).

1. Create an **ADEETIE Foundry** engagement and a **CCTS Cement** engagement.
2. Upload real or anonymised evidence (bills, fuel records, production logs). Extract. Accept
   fields on the review workbench. There is no “load demo facts” button.
3. Run calculation.
4. Open **Findings**. For each finding, check the citation panel: verbatim clause, document
   title, page. Accept, edit, or reject.
5. Open **ECM suggestions**. You should see library rows only — or “no matching ECM in library”
   if that sector is not seeded yet. That empty state is correct.
6. Write defects: wrong clause, missing rule, confusing copy, a field you would never accept.

Do not treat any remaining synthetic citation text (if the founder has not yet replaced the
demo ingest) as gazetted law. If a source URL looks like `example.invalid` or a title says
SYNTHETIC, stop and tell the founder to delete those rows before any client sitting.

---

## 3. Feature 1 — regulatory documents to collect

Collect **PDFs or official URLs**. Do not paraphrase. Tag each file with scheme and sector.

Start with **Foundry + Cement only**. Expand later.

| Document | Where | Used for |
| --- | --- | --- |
| ADEETIE operational guidelines (current edition) | [beeindia.gov.in](https://beeindia.gov.in) ADEETIE / MSME pages | Eligibility, 10% savings, loan, cluster, subvention |
| CCTS Detailed Procedure for Compliance Mechanism | BEE / CCTS / MoP notifications | Data flow, NCV vs GCV, NABL, sampling, completeness |
| Cement sector methodology | CCTS / PAT sector pack | Normalization, exclusions |
| Foundry / ADEETIE sector notes | Same | Energy balance, calibration, baseline year |
| PAT general + sector normalization pro-formas (if still cited) | BEE PAT | Cement-style rules |
| Notified cluster annex / Udyam rules if the guideline points to them | ADEETIE annex; Udyam portal | Geographic and MSME gates |

For each file, deliver a one-line index:

```
title | year/edition | scheme (ADEETIE/CCTS/PAT) | sector or "general" | file path or URL
```

Also deliver **~15–20 labelled pairs**:

```
rule_id or finding heading → expected clause / paragraph / page
```

Example: `AD-ELG003 (loan outside range) → ADEETIE guidelines, eligible loan size, p.X`.

The founder uses those pairs to check retrieval. You do not write embeddings or SQL.

---

## 4. Feature 2 — ECM library spreadsheet

Use a published **BEE sector ECM / energy-efficiency guide**. One official guide beats ten blogs.
Do not use vendor brochures. Do not generate rows with ChatGPT.

Columns (one row = one measure you would put your name on):

| Column | Rule |
| --- | --- |
| `sector_or_cluster` | Foundry, Cement, … — must match the pack sector name |
| `scheme` | `ADEETIE`, `CCTS`, or blank if scheme-agnostic |
| `equipment_tag` | Must match pack stream ids already in the product, e.g. `coke`, `grid-electricity`, `png`, `coal-kiln`, `grid-ht` |
| `ecm_name` | From the guide |
| `description` | From the guide — no extra engineering advice |
| `typical_savings_range` | Only if the guide states it |
| `typical_payback_months` | Only if the guide states it |
| `source_reference` | `BEE [exact title], [year], Sec X.Y` |
| `source_url` | Official URL if any |

Sign the sheet (name, empanelment number, date). The founder loads it. Until that sheet exists,
ECM will correctly show no matches.

---

## 5. Confirm these scheme numbers

Reply yes/no + the clause if different:

- Minimum energy savings: **10%**, achieved and sustained  
- Eligible loan: **₹10 lakh – ₹15 crore**  
- Debt share of project cost: **up to 75%**  
- Cluster proximity: **200 km**  
- Interest subvention: **5% Micro/Small, 3% Medium**, floor **2% net**  
- M&V “sustained” window: what duration should we encode?

---

## 6. What you must not do

- Invent ECMs or “improve” regulatory wording  
- Change factor values in the app  
- Cite synthetic / demo clauses in a client report  
- Ask a model to fill the library “to save time”

When in doubt, send the PDF and a page number. The founder will ingest verbatim text.
