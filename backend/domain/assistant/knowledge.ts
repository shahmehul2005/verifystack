/**
 * The website assistant's entire knowledge.
 *
 * Every entry restates something already true in the product, its UI copy or
 * docs/architecture/overview.md. The assistant may only answer from these
 * entries, so anything not written here is, by design, something it cannot say.
 * Keep scheme thresholds, factor values and regulatory interpretation out: those
 * are unverified reference data and belong to a verifier, not a chat bubble.
 */

export interface KnowledgeEntry {
  id: string;
  title: string;
  body: string;
  /** Words a visitor would plausibly use for this topic. Matched after normalisation. */
  keywords: string[];
  /** A public page that covers the topic, when there is one. */
  href?: string;
}

export const KNOWLEDGE: readonly KnowledgeEntry[] = [
  {
    id: "about",
    title: "What VerifyStack is",
    body: "VerifyStack is a verification workbench for two Bureau of Energy Efficiency (BEE) schemes: the Carbon Credit Trading Scheme (CCTS) and ADEETIE. It takes a verification firm from raw evidence (bills, fuel invoices, lab certificates, production logs) to a named, two-person sign-off. Every document is hashed, every extracted value keeps its source location, every calculation is versioned and hash-chained, and every AI output waits for a human decision.",
    keywords: ["verifystack", "website", "site", "product", "platform", "app", "application", "tool", "software", "about", "purpose", "overview", "workbench"],
    href: "/",
  },
  {
    id: "who-for",
    title: "Who VerifyStack is for",
    body: "VerifyStack is sold only to the verifier: Accredited Carbon Verification Agencies (ACVAs) under CCTS and BEE-empanelled energy auditors under ADEETIE. It is never sold to the audited party, whether that is a CCTS obligated entity or an MSME applying under ADEETIE. The verifier signs a statement that carries professional and statutory liability, so the product's job is to make every number traceable to evidence, not to make a facility's numbers look better.",
    keywords: ["customer", "customers", "audience", "user", "users", "buy", "sold", "acva", "auditor", "auditors", "verifier", "verifiers", "firm", "firms", "obligated", "entity", "plant", "industry", "company", "suitable"],
  },
  {
    id: "schemes",
    title: "Supported schemes",
    body: "VerifyStack supports two BEE schemes. CCTS (Carbon Credit Trading Scheme): an ACVA verifies one compliance year per obligated entity, and the metric is GEI (greenhouse gas emission intensity). ADEETIE: a BEE-empanelled energy auditor works through three passes per MSME (IGEA, then DPR, then M&V), and the metric is SEC (specific energy consumption).",
    keywords: ["scheme", "schemes", "support", "supported", "cover", "covers", "bee", "bureau", "ccts", "adeetie", "programme", "program", "regulation", "regulations"],
    href: "/#schemes",
  },
  {
    id: "ccts",
    title: "CCTS in VerifyStack",
    body: "CCTS is the Carbon Credit Trading Scheme. Obligated entities must meet notified GEI targets, and accredited verification agencies (ACVAs) verify the results. In VerifyStack an ACVA opens one engagement per obligated entity and compliance year (for example FY2025-26), bound to a sector methodology pack. The engine computes GEI, rules raise findings, and the lead verifier and an independent reviewer sign. Filing on the Indian Carbon Market (ICM) portal is outside VerifyStack.",
    keywords: ["ccts", "carbon", "credit", "credits", "trading", "acva", "obligated", "compliance", "target", "targets", "gei", "emission", "emissions", "ghg"],
    href: "/#schemes",
  },
  {
    id: "adeetie",
    title: "ADEETIE in VerifyStack",
    body: "ADEETIE (Assistance in Deploying Energy Efficient Technologies in Industries & Establishments) offers interest subvention to MSMEs that adopt energy-efficient technology and prove the savings. In VerifyStack a BEE-empanelled energy auditor runs one engagement per MSME through three phases: IGEA (investment grade energy audit, which sets the baseline SEC), DPR (detailed project report with measures, projected savings, project cost, loan and subvention) and M&V (monitoring and verification of post-implementation SEC against the baseline).",
    keywords: ["adeetie", "msme", "msmes", "subvention", "interest", "efficiency", "efficient", "technology", "auditor", "empanelled", "igea", "dpr", "mv", "enterprise", "loan"],
    href: "/#schemes",
  },
  {
    id: "adeetie-phases",
    title: "ADEETIE phases",
    body: "An ADEETIE engagement runs the verification pass three times. IGEA produces the baseline SEC, the energy balance and the identified measures. DPR records measures, projected savings, project cost, loan and subvention. M&V measures post-implementation SEC and savings against the baseline. A phase can only advance once its pass is submitted, an open blocking finding stops the advance, the baseline is locked at IGEA, and M&V evidence never silently reuses the baseline documents.",
    keywords: ["phase", "phases", "igea", "dpr", "mv", "baseline", "advance", "lifecycle", "monitoring", "savings", "measures", "report", "detailed", "investment", "grade"],
  },
  {
    id: "adeetie-eligibility",
    title: "ADEETIE eligibility checks",
    body: "When a lead verifier creates an ADEETIE engagement, the form checks the enterprise details as they are entered: Udyam registration, enterprise category (micro, small or medium), notified cluster or claimed distance to one, loan amount, project cost and subvention rate. These checks warn; they are not an eligibility decision, and the values are recorded for the verifier to confirm. Udyam numbers are format-checked, not looked up on the registry, and cluster distance is claimed, not computed. The scheme parameters behind the checks are reference data marked for verification.",
    keywords: ["eligibility", "eligible", "udyam", "registration", "cluster", "clusters", "notified", "distance", "category", "micro", "small", "medium", "loan", "subvention", "check", "checks", "qualify"],
  },
  {
    id: "gei",
    title: "GEI (greenhouse gas emission intensity)",
    body: "GEI is the CCTS metric: tonnes of CO2 equivalent per tonne of equivalent product. VerifyStack computes it as total emissions (scope 1 fuel and process emissions plus scope 2 grid electricity) divided by equivalent product, which each sector pack defines. The calculation is done by versioned code, never by a model.",
    keywords: ["gei", "intensity", "emission", "emissions", "co2", "co2e", "tco2e", "scope", "equivalent", "product", "greenhouse", "ghg", "formula", "calculate", "computed"],
  },
  {
    id: "sec",
    title: "SEC (specific energy consumption)",
    body: "SEC is the ADEETIE metric: energy per unit of production, which the packs report in GJ per tonne. VerifyStack computes total energy divided by production, converting fuel quantities to energy with energy content factors. The IGEA run sets the baseline SEC; the M&V run measures post-implementation SEC against it.",
    keywords: ["sec", "specific", "energy", "consumption", "production", "gj", "tonne", "baseline", "savings", "formula", "calculate", "computed"],
  },
  {
    id: "how-it-works",
    title: "How an engagement works",
    body: "An engagement moves through these steps: setup (bind the engagement to a methodology pack), intake (upload evidence, which is hashed and stored privately), extraction (values are read from each page with their source location), review (a person accepts, corrects or rejects each value, and accepted values become facts), calculation (the engine reads facts and writes a hash-chained run), findings (rules raise blocking, warning or info findings with a cited clause) and sign-off (the lead verifier and a different independent reviewer sign).",
    keywords: ["workflow", "process", "steps", "step", "engagement", "engagements", "pipeline", "flow", "procedure", "stages", "status"],
    href: "/#how-it-works",
  },
  {
    id: "packs",
    title: "Methodology packs and sectors",
    body: "A methodology pack is a data record for one sector: document types, field schemas, calculation method (GEI or SEC), factor references, stream and production bindings, the rule set and a clause citation for every rule. VerifyStack ships CCTS packs for 9 sectors and ADEETIE packs for 14 sectors; the Library page in the app lists them and shows which are runnable. An engagement is bound to its pack at setup and cannot be rebound later.",
    keywords: ["pack", "packs", "methodology", "sector", "sectors", "industry", "industries", "cement", "steel", "aluminium", "library", "rules", "fields", "foundry"],
    href: "/#schemes",
  },
  {
    id: "evidence-upload",
    title: "Uploading evidence",
    body: "On an engagement's Documents page you upload a PDF or an image (PNG, JPEG or WebP, up to 50 MB) of a bill, invoice, lab certificate or production log. Each file is SHA-256 hashed, stored privately under its hash and split into pages, and the hash is shown as the file's fingerprint. Lead verifiers and verifiers can upload.",
    keywords: ["upload", "uploading", "evidence", "document", "documents", "file", "files", "pdf", "image", "bill", "bills", "invoice", "invoices", "certificate", "log", "hash", "size", "format", "formats"],
  },
  {
    id: "extraction",
    title: "Extraction",
    body: "Digital PDFs are parsed deterministically; scanned pages are read by Google Gemini when a Gemini key is configured. Every extracted value must carry its document, page, bounding box and verbatim source text, or it is not kept. Extracted values arrive as suggestions marked as AI-proposed; none of them becomes a fact until a person accepts it.",
    keywords: ["extract", "extraction", "extracted", "ocr", "scan", "scanned", "read", "gemini", "parse", "parsing", "fields", "values", "provenance", "automatic"],
  },
  {
    id: "review",
    title: "Reviewing extracted values",
    body: "The workbench shows each extracted value next to the evidence page with its source region highlighted. A reviewer accepts, corrects or rejects each one, and J and K move between fields. The review queue collects values that need a person before they become facts: anything material (quantities, calorific values, production, energy) or with confidence below 90%. Lead verifiers, verifiers and independent reviewers can review.",
    keywords: ["review", "reviewing", "workbench", "queue", "accept", "correct", "reject", "confidence", "material", "highlight", "keyboard", "shortcut", "shortcuts", "verify", "check"],
  },
  {
    id: "facts",
    title: "Facts and provenance",
    body: "A fact is an extracted value that a named person accepted or corrected. Only facts feed calculations. Each fact keeps its provenance: the document, page, bounding box and verbatim source text it came from, so any number in a result can be traced back to the evidence.",
    keywords: ["fact", "facts", "ledger", "provenance", "traceable", "trace", "traceability", "source", "evidence", "origin"],
  },
  {
    id: "calculation",
    title: "Calculation runs",
    body: "The lead verifier executes calculation runs. The engine reads facts through the pack's bindings and computes GEI or SEC in versioned code. Each run records the engine version, pack version and an input hash, and is hash-chained to the previous run so the history is tamper-evident. Any use of a reference factor that is not yet verified is written into the run's warnings.",
    keywords: ["calculation", "calculations", "calculate", "run", "runs", "engine", "compute", "computes", "result", "results", "hash", "chain", "chained", "reproducible", "version", "tamper"],
  },
  {
    id: "ai-role",
    title: "What AI does and does not do",
    body: "In VerifyStack code computes and models never do. Models classify pages, extract values, retrieve regulatory text and draft wording; they never produce a number that reaches a result. Every AI output is created as a suggestion and needs an explicit accept, edit or reject from a named user. After every generation, code checks the output against the records the model was given and discards it if it does not match.",
    keywords: ["ai", "artificial", "intelligence", "model", "models", "llm", "gemini", "machine", "learning", "automated", "automatic", "hallucinate", "hallucination", "trust", "accurate", "accuracy"],
  },
  {
    id: "findings",
    title: "Findings and CARs",
    body: "Rules check the facts and raise findings with a severity of block, warn or info. An open blocking finding prevents sign-off and, for ADEETIE, stops a phase from advancing. Each finding can carry a retrieved regulatory citation and a Corrective Action Request (CAR) drafted from a template, which a person accepts, edits or rejects.",
    keywords: ["finding", "findings", "rule", "rules", "block", "blocking", "warn", "warning", "severity", "car", "corrective", "action", "request", "issue", "issues", "nonconformity"],
  },
  {
    id: "citations",
    title: "Regulatory citations",
    body: "When a finding is raised, VerifyStack retrieves regulatory text for the pack's scheme and sector and asks the model to explain only the retrieved text. Code then checks that every cited clause was in what the model received. The outcome is shown as grounded, rejected, no applicable clause or unavailable, and a person accepts, edits or rejects it.",
    keywords: ["citation", "citations", "cite", "clause", "clauses", "regulatory", "regulation", "grounded", "groundedness", "reference", "references", "source", "sources", "retrieval"],
  },
  {
    id: "ecm",
    title: "Energy conservation measures",
    body: "For ADEETIE, the ECM page suggests energy conservation measures by matching library rows deterministically on sector, equipment and the intensity gap. A model may reword a matched row, but wording that adds facts not on the row is rejected and the raw row is shown instead. When nothing matches, the page says there is no matching ECM in the library.",
    keywords: ["ecm", "ecms", "conservation", "measure", "measures", "suggestion", "suggestions", "recommendation", "recommendations", "equipment", "savings", "library"],
  },
  {
    id: "signoff",
    title: "Sign-off (maker and checker)",
    body: "Sign-off needs two different people: the lead verifier and an independent reviewer. No role holds both sign-off rights, and the system also rejects the same user signing both sides. Open blocking findings prevent sign-off. Each signature is a named attestation recorded in the append-only audit log.",
    keywords: ["sign", "signoff", "signature", "signatures", "sign-off", "approve", "approval", "maker", "checker", "independent", "reviewer", "lead", "attest", "attestation", "statement"],
  },
  {
    id: "reports",
    title: "Reports",
    body: "VerifyStack produces PDF reports from the recorded runs: the CCTS verification report, and the ADEETIE IGEA, DPR and M&V reports. Every role in the firm can download reports.",
    keywords: ["report", "reports", "pdf", "download", "export", "output", "statement"],
  },
  {
    id: "roles",
    title: "Roles",
    body: "A firm has four roles. Firm admin runs the firm: the team and the audit log, with no verification powers. Lead verifier creates engagements, runs calculations and signs as lead. Verifier uploads evidence, extracts, reviews values and works findings, but cannot sign. Independent reviewer reviews and gives the second, independent signature.",
    keywords: ["role", "roles", "permission", "permissions", "admin", "administrator", "lead", "verifier", "reviewer", "independent", "access", "rights", "team"],
  },
  {
    id: "signup",
    title: "Creating an account",
    body: "Create your firm's account from the Create account page. The person who signs up becomes the firm admin of a new firm and receives a confirmation link by email. A deployment can restrict signup to approved email domains. If a colleague has already set up your firm, ask them for an invite instead of signing up, because signing up on your own creates a separate firm.",
    keywords: ["signup", "sign", "register", "registration", "account", "create", "join", "firm", "onboarding", "trial", "confirm", "confirmation"],
    href: "/signup",
  },
  {
    id: "invites",
    title: "Inviting your team",
    body: "A firm admin invites colleagues from the Team page by email and role. The invite link is valid for 14 days and opens the create-account page with the invited email and role filled in. If that email already has an account, the invitee enters their existing password; an invite never resets one. The Team page also shows the link so it can be shared directly.",
    keywords: ["invite", "invites", "invitation", "team", "colleague", "colleagues", "member", "members", "join", "link", "expire", "expiry"],
  },
  {
    id: "sign-in",
    title: "Signing in and passwords",
    body: "Sign in with your email and password, or with Google on the sign-in page. If you forget your password, use Forgot password: VerifyStack emails a reset link that expires after about an hour. Once signed in, you can change your password from the account menu.",
    keywords: ["login", "log", "signin", "sign", "password", "forgot", "reset", "google", "change", "credentials", "locked", "access"],
    href: "/login",
  },
  {
    id: "demo",
    title: "Requesting a demo",
    body: "Use the Request a demo form at the bottom of the home page. Give your name, work email, firm and the scheme you work on, with an optional note, and the team replies by email.",
    keywords: ["demo", "demonstration", "contact", "sales", "talk", "meeting", "call", "trial", "touch", "reach", "email", "enquiry", "inquiry"],
    href: "/#demo",
  },
  {
    id: "pricing",
    title: "Pricing",
    body: "Pricing is not published on the website. Request a demo from the home page and the team will reply by email.",
    keywords: ["price", "prices", "pricing", "cost", "costs", "plan", "plans", "subscription", "fee", "fees", "license", "licence", "charge", "free", "paid"],
    href: "/#demo",
  },
  {
    id: "security",
    title: "Security and tenant isolation",
    body: "Each firm's data is scoped to its organisation and protected by row-level security; signed-in users can read their own firm's records and write nothing directly, because every change goes through a server route that checks the user's role. Evidence files live in a private storage bucket and are streamed only after an organisation check. Audit events, calculation runs, sign-offs and facts are append-only. Cross-site writes are refused and sign-in and model-calling routes are rate limited.",
    keywords: ["security", "secure", "safe", "safety", "isolation", "tenant", "encryption", "access", "protect", "protected", "hack", "breach", "rls", "permission", "confidential", "confidentiality"],
  },
  {
    id: "privacy",
    title: "Privacy and data",
    body: "Evidence files may be sent to Google Gemini for classification and field extraction when a Gemini key is configured for the deployment. Upload evidence only if your firm has a lawful basis to process it under the Digital Personal Data Protection Act, 2023 and the applicable BEE and CCTS confidentiality terms. VerifyStack does not use extracted values to train models. Questions typed into this assistant are also sent to Google Gemini, so do not paste client data here.",
    keywords: ["privacy", "data", "dpdp", "personal", "gdpr", "gemini", "google", "train", "training", "share", "sharing", "store", "stored", "storage", "confidential", "lawful"],
    href: "/privacy",
  },
  {
    id: "audit-log",
    title: "Audit log",
    body: "Every upload, review decision, calculation run and sign-off is written to an append-only audit log with who did it and when. The firm admin can view the audit log in the app.",
    keywords: ["audit", "log", "logs", "trail", "history", "activity", "record", "records", "changes", "append"],
  },
  {
    id: "factors",
    title: "Reference factors",
    body: "Emission factors (from CEA and IPCC) and energy content factors (from BEE) are reference data owned by the platform, each with a source, a vintage and a verified flag. VerifyStack platform stewards cite and correct them; firms do not attest factors. A calculation that uses a factor not yet verified records that in the run's warnings. The assistant does not quote factor values.",
    keywords: ["factor", "factors", "emission", "cea", "ipcc", "grid", "calorific", "ncv", "gcv", "vintage", "reference", "steward", "verified", "unverified", "default"],
  },
  {
    id: "evidence-types",
    title: "Evidence beyond PDFs",
    body: "Besides PDFs and scanned images, VerifyStack accepts Excel (XLSX) and CSV files, including meter or SCADA time series, and an evidence pack: a ZIP with a manifest that lists its files and what the entity declared. A value read from a spreadsheet cell or a time-series range is mapped by the verifier, re-read by the server, and kept with the cell or range it came from. What the entity declared is compared with what was read, and is never treated as a fact.",
    keywords: ["excel", "xlsx", "csv", "spreadsheet", "scada", "timeseries", "series", "meter", "pack", "zip", "manifest", "declared", "declaration", "cell", "image", "scan", "formats"],
  },
  {
    id: "bulk-accept",
    title: "Reviewing many values quickly",
    body: "Low-risk extracted values can be accepted together, but only after a sample of them has been reviewed one by one and every sampled value was accepted unchanged. A value counts as low risk only if it is read from a document page, is not material to the result, was extracted with high confidence, and does not contradict what the entity declared. Each bulk action is recorded, and the share of bulk-accepted values is disclosed in the submission package.",
    keywords: ["bulk", "sample", "sampling", "triage", "lowrisk", "quickly", "faster", "many", "batch", "shortcut", "confidence"],
  },
  {
    id: "planning",
    title: "Verification planning",
    body: "Before reviewing evidence, a lead verifier can record a verification plan: risk ratings for factors such as data quality and complexity, the sampling rate that follows, and whether a site visit is warranted. Plans are saved as new versions and approved versions cannot be edited, so the history of what was planned, and when, is kept.",
    keywords: ["plan", "planning", "risk", "rating", "ratings", "approach", "strategy", "version", "versions", "visit"],
  },
  {
    id: "fieldwork",
    title: "Fieldwork and site visits",
    body: "Site visits can be scheduled and observations recorded against them, from a phone if needed. Observations are saved on the device while offline and sent when the connection returns, without creating duplicates. A recorded observation is only a proposal: someone other than the person who recorded it has to accept it before it becomes a fact.",
    keywords: ["fieldwork", "field", "site", "visit", "visits", "observation", "observations", "offline", "phone", "mobile", "photo", "photos", "walkthrough"],
  },
  {
    id: "issues",
    title: "Findings, responses and closing issues",
    body: "A finding can be opened with the audited entity. The entity receives a link that opens only that one issue, needs no account, and works once. They write their answer and attach files, and the issue moves to responded. The verifier reads it, verifies it or re-opens the issue, and then closes it. A blocking issue has to go through the whole path before sign-off; warnings and notes can be closed earlier. A verifier can also record a response received by phone or email.",
    keywords: ["issue", "issues", "respond", "response", "responses", "reply", "link", "entity", "client", "audited", "close", "closing", "open", "overdue", "due", "ageing"],
  },
  {
    id: "technical-review",
    title: "Independent technical review",
    body: "The independent reviewer can record a technical review before sign-off: approve, or request changes with reasons. Anyone who accepted facts or ran a calculation in the engagement cannot review it. The review is tied to the facts and calculation as they were, so if either changes afterwards it no longer counts and a new review is needed. A request for changes blocks sign-off. Whether a given scheme requires a review is not yet confirmed, so it is optional by default.",
    keywords: ["technical", "review", "reviewer", "approve", "approval", "changes", "independent", "stale"],
  },
  {
    id: "submission-package",
    title: "The submission package",
    body: "When an engagement is ready, the lead verifier can download a single ZIP containing the accepted facts with their sources, the calculation record, the findings and their outcome, the sign-offs and the evidence files, each listed with a SHA-256 digest. It states plainly that its layout is generic, because no scheme or portal template has been confirmed, and it discloses the bulk-accepted share, the technical review status and any unverified factors. It will not build until the run, both signatures and the finding gate are in place. VerifyStack does not submit it anywhere.",
    keywords: ["package", "download", "zip", "handover", "hand", "bundle", "export", "digest", "sha", "manifest", "deliverable"],
  },
  {
    id: "import-stages",
    title: "Importing engagements and tracking stages",
    body: "A lead verifier can import a portfolio of engagements from a CSV or Excel file. The file is checked row by row first, rows with problems are listed and skipped, and nothing is created until you confirm. ADEETIE engagements also carry a stage, from expression of interest to closed, as a tracker for the firm: moving it does not unlock or lock any work.",
    keywords: ["import", "portfolio", "upload", "bulk", "template", "stage", "stages", "tracker", "pipeline", "rows", "spreadsheet"],
  },
  {
    id: "limits",
    title: "Reference data marked for verification",
    body: "Some reference data ships marked as not yet verified: reference factors, clause references, scheme thresholds and the ADEETIE cluster list. VerifyStack shows that status wherever the data is used, and a verifier must confirm the values against the published BEE and CEA documents.",
    keywords: ["limitation", "limitations", "limit", "limits", "unverified", "verified", "threshold", "thresholds", "accurate", "accuracy", "official", "reliable", "trust"],
  },
  {
    id: "icm",
    title: "Filing on the ICM portal",
    body: "VerifyStack does not file results on the Indian Carbon Market (ICM) portal. It produces the verified, signed record and report; filing is done outside the product.",
    keywords: ["icm", "indian", "market", "portal", "registry", "file", "filing", "submit", "submission", "upload"],
  },
  {
    id: "assistant",
    title: "About this assistant",
    body: "This assistant answers questions about VerifyStack only: what it does, the CCTS and ADEETIE workflows, roles, accounts, security and privacy. It cannot see your engagements or any firm's data, and it does not give factor values, scheme thresholds, or legal, regulatory or engineering advice.",
    keywords: ["assistant", "chatbot", "bot", "chat", "capable", "scope"],
  },
];

export function knowledgeById(id: string): KnowledgeEntry | undefined {
  return KNOWLEDGE.find((e) => e.id === id);
}
