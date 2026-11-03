# VerifyStack — Low-Level Data Flow Diagrams (Level 1 & 2)

Paste any code block below into draw.io via **Extras → Edit Diagram**, or use the Mermaid import plugin. Each is a separate diagram — import them one at a time as separate pages/tabs, don't merge them.

## Notation used

- **Rectangle** `["..."]` — External Entity (something outside the system: a person or an outside system)
- **Rounded rectangle** `("N.N ...")` — Process, numbered per standard DFD leveling
- **Cylinder** `[("...")]` — Data Store

The whole point of this design: **Process 5.0 (Reconciliation & Calculation) and Process 3.0 (Extraction) never contain sector-specific logic.** All 9 CCTS sectors (Aluminium, Cement, Chlor-Alkali, Pulp & Paper, Iron & Steel, Fertilizer, Petrochemicals, Petroleum Refining, Textiles) and every ADEETIE cluster are handled by loading a different **Methodology Pack (D3)** — a data record, not new code. Adding a 10th sector later means adding a pack, not touching these diagrams.

---

## Level 1 DFD — whole system

```mermaid
flowchart TB
    EE1["Verifier / Auditor"]
    EE2["Reviewing Authority<br/>(BEE / ICM / Lending Institution)"]
    EE3["Vision–LLM API<br/>(external AI service)"]
    EE4["Reference Data Provider<br/>(CEA / IPCC / NABL registries)"]

    P1("1.0 Engagement &amp; Pack Setup")
    P2("2.0 Document Intake &amp; Classification")
    P3("3.0 Field Extraction")
    P4("4.0 Validation &amp; Human Review Gate")
    P5("5.0 Reconciliation &amp; Calculation")
    P6("6.0 Findings Generation &amp; Drafting")
    P7("7.0 Review, Sign-off &amp; Report Submission")

    D1[("D1 Engagement Store")]
    D2[("D2 Document Store<br/>hashed, deduped")]
    D3[("D3 Methodology Pack Store<br/>factors · schemas · rules · templates")]
    D4[("D4 Extracted Facts Store<br/>provenance-tagged")]
    D5[("D5 Calculation Run Store<br/>versioned, hash-chained")]
    D6[("D6 Findings Store")]
    D7[("D7 Audit Log<br/>append-only")]
    D8[("D8 Reference Data Cache")]

    EE1 -->|"select engagement + sector/scheme"| P1
    P1 -->|"engagement record"| D1
    P1 -->|"request pack (e.g. CCTS-Cement, ADEETIE-Foundry)"| D3
    D3 -->|"pack config"| P1

    EE1 -->|"upload evidence documents"| P2
    P2 -->|"store raw file"| D2
    D3 -->|"doc-type taxonomy (per pack)"| P2
    P2 -->|"classified doc + page split"| P3

    D3 -->|"field schema (per pack)"| P3
    P3 -->|"document image/text"| EE3
    EE3 -->|"raw fields + confidence"| P3
    P3 -->|"extracted fields, unverified, w/ provenance"| P4

    P4 -->|"low-confidence / high-materiality fields"| EE1
    EE1 -->|"accept / reject / correct"| P4
    P4 -->|"committed facts"| D4
    P4 -->|"rejection events"| D7

    D4 -->|"committed facts"| P5
    D3 -->|"formulas + factors (per pack)"| P5
    EE4 -->|"published factor updates"| D8
    D8 -->|"reference factors"| P5
    P5 -->|"versioned run: engine ver, pack ver, input hash"| D5
    P5 -->|"rule violations + calculated values"| P6
    P5 -->|"audit event"| D7

    D3 -->|"clause citations + report template (per pack)"| P6
    P6 -->|"evidence refs + rule result"| EE3
    EE3 -->|"drafted finding text"| P6
    P6 -->|"findings (state = suggested)"| D6
    P6 -->|"draft findings for review"| EE1

    EE1 -->|"accept / edit / reject; sign-off"| P7
    P7 -->|"update finding state"| D6
    P7 -->|"append sign-off event"| D7
    P7 -->|"final report / Form A-B / DPR"| EE2
```

---

## Level 2 DFD — decomposition of Process 3.0 (Field Extraction)

```mermaid
flowchart TB
    P2("2.0 Document Intake<br/>upstream")
    D3[("D3 Methodology Pack Store")]
    EE3["Vision–LLM API"]
    P4("4.0 Validation &amp; Human Review<br/>downstream")
    D7[("D7 Audit Log")]

    P31("3.1 Route by Document Type<br/>pack schema lookup")
    P32("3.2 Deterministic Layout Parser<br/>clean digital PDFs")
    P33("3.3 Vision-Language Extraction<br/>scans / handwriting")
    P34("3.4 Confidence Scoring &amp;<br/>Bounding-Box Tagging")
    P35("3.5 Provenance Validation Gate")

    P2 -->|"classified document"| P31
    D3 -->|"expected fields per doc type"| P31
    P31 -->|"clean digital PDF"| P32
    P31 -->|"scan / handwritten"| P33

    P33 -->|"document image"| EE3
    EE3 -->|"fields + raw confidence"| P33

    P32 -->|"parsed fields"| P34
    P33 -->|"extracted fields"| P34

    P34 -->|"fields + confidence + bbox"| P35
    P35 -->|"valid: doc id, page, bbox, source text present"| P4
    P35 -->|"reject: missing provenance"| D7
```

---

## Level 2 DFD — decomposition of Process 5.0 (Reconciliation & Calculation)

```mermaid
flowchart TB
    D4[("D4 Extracted Facts Store<br/>committed, unit-safe")]
    D3[("D3 Methodology Pack Store")]
    D8[("D8 Reference Data Cache")]
    P6("6.0 Findings Generation<br/>downstream")
    D5[("D5 Calculation Run Store")]
    D7[("D7 Audit Log")]
    EE1["Verifier / Auditor"]

    P51("5.1 Load Pack Formulas &amp; Factors<br/>e.g. GEI method for Cement,<br/>SEC method for ADEETIE cluster")
    P52("5.2 Unit Safety Check<br/>dimensional validation")
    P53("5.3 Apply Sector-Specific Calculation")
    P54("5.4 Run Reconciliation Rule Set<br/>pack rules + universal rules")
    P55("5.5 Physical Plausibility Gate")
    P56("5.6 Version, Hash &amp; Commit Run")

    D3 -->|"formula + factor set for selected pack"| P51
    D8 -->|"default/reference factors"| P51

    D4 -->|"committed facts"| P52
    P52 -->|"unit-safe facts"| P53
    P51 -->|"formula + factors"| P53

    P53 -->|"calculated values (GEI, SEC, etc.)"| P54
    D3 -->|"reconciliation rule set for pack"| P54

    P54 -->|"values + rule results"| P55
    P55 -->|"implausible value flagged"| EE1
    P55 -->|"plausible values + rule results"| P56

    P56 -->|"versioned run: engine ver, pack ver, input hash"| D5
    P56 -->|"rule violations + calculated values"| P6
    P56 -->|"audit event"| D7
```

---

## How this covers all 9 CCTS sectors and every ADEETIE cluster without new processes

Each pack in D3 is a record shaped like this (illustrative, not final schema):

```
{
  pack_id: "CCTS-CEMENT-v1" | "ADEETIE-FOUNDRY-v1" | ...,
  scheme: "CCTS" | "ADEETIE",
  sector_or_cluster: "Cement" | "Foundry" | ...,
  document_taxonomy: [...],       // used by 3.1
  field_schemas: {...},           // used by 3.1 / 3.4
  calculation_method: "GEI" | "SEC" | ...,   // used by 5.1 / 5.3
  emission_or_energy_factors: {...},          // used by 5.1
  reconciliation_rules: [...],    // used by 5.4
  clause_citations: [...],        // used by 6.0
  report_template: "..."          // used by 6.0 / 7.0
}
```

Onboarding sector #10 (or ADEETIE cluster #4) means writing one new pack record — not touching Processes 1.0–7.0. This is the same "config, not code" principle used by mature audit-tooling platforms (CaseWare, Fieldguide) that support many audit frameworks on one engine.
