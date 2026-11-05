# Changelog

Notable changes to VerifyStack. The format follows [Keep a Changelog](https://keepachangelog.com/).

Calculation runs record their engine and pack versions, so any change that can alter a result
must say which version it bumps. Current versions:

| Component                     | Version                           | Defined in                              |
| ----------------------------- | --------------------------------- | --------------------------------------- |
| GEI engine (`ENGINE_VERSION`) | 0.1.0                             | `backend/domain/calc/engine.ts`         |
| SEC engine (`SEC_ENGINE_VERSION`) | 0.1.0                         | `backend/domain/calc/sec.ts`            |
| CCTS packs (9 sectors)        | 1.0.0                             | `backend/domain/packs/ccts/`            |
| ADEETIE packs (14 sectors)    | 1.0.0                             | `backend/domain/packs/adeetie/`         |
| Extraction prompt             | `2026-08-31.classify-no-soften`   | `backend/domain/extraction/gemini.ts`   |
| Citation prompt               | `2026-09-05.cite-retrieved-only`  | `backend/domain/citations/types.ts`     |

## [Unreleased]

### Registry: a deterministic normaliser for units, calorific basis and reporting period

- New `backend/domain/registry/normalize.ts`. Code only; no model is asked. It puts a reading on its registry entry's
  standard unit, reads the basis words printed beside a calorific value, and places a printed reporting period on the
  calendar. It stores nothing and changes no calculation, pack or factor.
- **Units** reuse the existing dimension-checked conversion. It refuses, with a reason, a missing unit, an unknown unit,
  a unit of another dimension, a convertible unit the entry does not accept, and **kVAh** (apparent energy, which is not
  kWh). It reads lakh and crore. The original value and unit are kept beside the result.
- **Calorific basis** separates the moisture basis (as received, air dried, dry) from gross or net. A net value is
  refused for a gross entry, a line that states two bases is refused, and a value with no stated basis is returned in
  kcal/kg with the basis open: it is never assumed to be as received. The moisture arithmetic is the existing converter's.
- **Reporting period** understands start and end fields, a single date, a text range, a month, a financial year and a
  quarter of the Indian financial year with its year. Slashed dates are read day-first and say so when the day could be a
  month; a month-first date is refused, not flipped. A quarter with no financial year, an impossible date, a period that
  ends before it starts and anything unreadable are marked **unknown** with a reason. An unknown period is a state, not a
  default.
- What it noticed: extraction's calorific-basis softening turns "ARB", "ADB" and "gross" all into "GCV", so a stored
  lab-certificate basis no longer says whether the coal was wet or dried. The printed words are still in the field's
  source text, which is what this reads. Not changed here.

### Registry: the cement quantities that two places define, written once, and a test that catches drift

- New `backend/domain/registry/` holds a cement registry for three quantities that appear both in the calculation and
  in desk review: clinker production, coal GCV and grid electricity import. Each entry lists every name the quantity
  goes by (pack binding, pro forma cell, desk-review reading, extraction field) with the span, unit and basis each name
  carries, and the near names that are different quantities. Definitions only: it stores no values, adds no table and
  changes no calculation, pack or factor. Everything is marked provisional and no numeric range is set.
- A conformance test checks the registry against the real pack, desk-review definition and extraction schemas: every
  cited name exists, units agree with the source, a pack pro forma input and its desk-review cell read the same row,
  what an extracted field becomes is recomputed against the pack's binding match, and a new name for one of these
  quantities fails the test until it is registered or excluded with a reason.
- What it found: the pack has no clinker input (its `production` is equivalent product), so a clinker log and an
  equivalent-product log land on the same extraction name; a fuel invoice read with a fuel kind of coal is stored as
  `coal.calorificValue`, which the cement kiln-coal binding does not read; and the pack's default units (MJ/kg, MWh)
  differ from the pro forma's (kcal/kg, kWh). None is changed here. Open definitional questions are in the
  regulatory register.

### Facts ledger: withdrawing a fact works, in one step, and its history cannot be changed

- **Withdraw failed every time** with "facts is append-only: DELETE is not allowed". The route copied the fact to
  `fact_withdrawals` and then deleted it from `facts`, which the append-only guard refuses; it also had to undo its own
  copy by hand when the delete failed. A withdrawal now goes through one database function, `withdraw_fact`
  (migration `0024`, apply after `0022`): in a single transaction it checks the engagement and the fact belong to the
  organization (under a lock, so sign-off cannot start halfway), copies the fact in full to `fact_withdrawals`, removes
  it from `facts`, marks its extracted value rejected and writes the audit entry. Any failure changes nothing.
- The function runs for the service role only. It lifts the append-only guard for its one DELETE and turns it off again
  straight after, inside the transaction. `fact_withdrawals` is now append-only too, so the history cannot be edited or
  removed. Refused once sign-off has started, as before.
- No calculation, pack or factor changes. Runs already made keep the figures they used; run again after withdrawing.

### Desk review: applying a suggested word reading no longer writes "undefined"

- A suggestion that is a word (the moisture basis read from a laboratory certificate) has no number, and Apply and
  Apply All read the number alone, so the box received the text "undefined". They now put in the word, and a suggestion
  with nothing usable is skipped with a message instead of being written. The banner shows the word, not "undefined".
- Two certificates printing different bases were never flagged, because the check compared the missing number. Word
  readings are now compared as words, ignoring case and spacing.

### Documents: a document whose file is missing from storage is a clear message, and can be repaired

- A document row can outlive its file (an upload that failed after the row was written, or a file removed from the bucket
  by hand). Opening it in a snip or the workbench gave a bare "Unexpected server response (500)". The file route now
  answers 404 with `file_missing` and the viewer says the file is missing from storage and to upload the same file again.
- Uploading the same file again into the same engagement used to find the existing row and do nothing, so a missing file
  could never be restored. It now checks storage and puts the bytes back when they are gone (the object is named by its
  own hash, so this is safe), and records `restoredFile` in the audit entry.

### Desk review: "Open Drawer to Fill" points at what the check is missing

- Opening the Corroboration drawer from a waiting check (the check's own button, or "Enter readings" on the lead
  schedule) now outlines every reading that check is missing, scrolls to the first and puts the cursor in it. The
  outline fades after about two seconds; reduced-motion users get a steady outline with no fade. A note at the top of the
  drawer names the check and how many readings to enter, and lists any it needs that are read from uploaded files and
  cannot be typed there, with a link to Documents. A daily series counts as one card. The plain "Corroboration
  Readings" button opens the drawer as before. UI only, no migration.

### Desk review: a figure that is not a number can no longer pass a check

- **A text cell in a numeric column** ("-", "NA") used to turn that column's total into NaN. The evidence-coverage and
  daily-agreement checks then passed on it ("Largest difference NaN%"). The reader now leaves such cells out of the total,
  the daily series and the months of evidence, accepts text like `1,234.5`, and says how many it left out. Those checks, the
  sum check and the engine now report "not applicable" for a figure that is not a number, never a pass. A daily
  agreement with nothing comparable no longer crashes.
- **A NABL certificate on an air-dried or dry basis could never be compared**, because the inherent moisture was never
  passed to the conversion. There is now a reading for it (`coal.nabl_inherent_moisture_pct`), used only when the
  certificate's basis needs it.
- **The plain NABL corroboration screen no longer fails a dried-basis certificate for the water alone**; the
  moisture-basis check compares it after conversion. An as-received certificate, or one with no stated basis, is
  compared as before.
- Open for the owner: the conversion treats a dry-basis (DB) value like an air-dried one, using the inherent moisture,
  as the existing tests expect. A strictly dry value has no moisture left. Not changed here.

### Day and night theme

- A sun / moon button in the app header and the public header switches theme. The choice is kept in this browser and
  applied before the page paints, so there is no flash. Night inverts the page's lightness and turns the hue back, so
  every colour pair keeps its contrast and status colours stay red, amber and green. Pictures, video and canvases (the PDF
  pages being read) are shown as they are. Printing is always the day theme.

### Desk review: moisture basis, carbonate floor, slip checks and digit screens

Decision record: [0025](docs/decisions/0025-desk-review-basis-chemistry-digit-screens.md).

- **Spreadsheets that plants send are read.** The XLSX reader accepts a namespace prefix on
  every element, including cells, values, formulas and strings. Before this, five of the
  supplied workbooks opened with the right sheet name and no rows, and nothing said so.
  Column headers may carry per-reader aliases, so `Clinker Output (t)` reads as clinker
  production while `Clinker Factor` still does not.
- **Calorific values are compared on one moisture basis.** `gcv_basis_nabl` converts the
  certificate to the internal log's basis and fails when the two moisture figures do not
  describe the same coal. A certificate that does not state its basis is reported as such,
  not assumed.
- **Calcination has a floor.** `calcination_stoich` fails a declared factor below the
  carbonate floor set by CaO and MgO, beyond a 2% analytical tolerance. The CO2/CaO and CO2/MgO
  constants are derived from atomic masses.
- **A document has to agree with itself.** `weighbridge_slip` checks gross minus tare equals the
  printed net. `checkProximateAnalysis` catches a proximate analysis that does not close to 100%.
- **Typed quantities are screened for digit patterns.** Terminal-digit uniformity, and Benford's
  first digit only where the values span one to three orders of magnitude. A narrow GCV series is
  declined with a reason instead of being flagged.
- **Optional readings do not block.** A check whose evidence a pack may not carry reports
  "not applicable", not "waiting".
- The lab reader keeps each sample's GCV and the mean moisture; Auto-suggest reads the
  certificate's basis, moisture and external GCV.

### Snip: the figure in the box is read for you

- **Draw a box and the text and figure are filled in.** When the page has a text layer, code reads the characters
  inside the box from the PDF itself (no model, nothing sent anywhere), fills "what is printed in the box", and fills
  the figure when there is exactly one. Indian and western digit grouping are handled. With several figures the form
  lists them to pick from; with none it says so. The person still checks both and presses Add.
- **Scans and images are typed by hand**, with a note saying why. Reading those would need a model, which stays off for
  snips as decided. It works in the workbench and in the desk-review snip dialog, which share the drawing layer.

### Facts ledger: see what is still missing, and take a wrong fact out

- **"Not found yet" in the workbench.** The snip form's field list is grouped by where each input stands, from the same
  readiness check a run uses: not found yet (the run needs it, or one of a group of alternative methods), optional
  (counted as zero if not added), and already in the ledger. A filled input cannot be chosen, because a second value on
  one input stops a run. The Snip button says how many inputs the calculation still needs.
- **The server refuses it too.** A snip on an input that already has a fact is refused with a 409.
- **Withdraw a fact, keeping it.** The Facts ledger has "Withdraw" on each fact: it asks why (at least 8 characters),
  copies the fact in full to the new `fact_withdrawals` table (migration 0022) with who and when, then removes it from
  `facts`, so a run reads only what stands. The value it came from is marked rejected. Withdrawn facts are listed on the
  same page. Refused once sign-off has started, and refused if the history cannot be written.
- **Energy-based runs warn on duplicates.** Two values on one input used to be resolved silently by taking the first.
  The run now says so and names the values. It does not block, so existing runs behave as before.

### Desk review: edit and withdraw readings with a history

- **Edit, add and withdraw in the Corroboration drawer.** Changing a figure already on record, or withdrawing it,
  asks for a reason (at least 8 characters). The route enforces it, not only the form. A first entry and an
  unchanged figure need none, and an unchanged figure is no longer rewritten on save, so it keeps who entered it.
- **Nothing is erased.** Every entry, edit and withdrawal is kept in the new append-only `desk_reading_history`
  (migration 0021) with who, when, why and the figure it replaced. The drawer shows it per reading under "History".
  A withdrawal takes the figure out of the checks but not out of the record. A day removed from a daily list is
  withdrawn the same way. Until 0021 is applied, readings still save and the earlier figure is kept in the audit log.
- Checks are not recomputed by an edit: run the desk review again to update them.

### Documents: extract every uploaded file with one button

- **Extract all.** The Documents tab has "Extract all (N)", which reads every PDF and image that has not been
  read yet, one after another, using the same request as each file's own Extract button. A file with a finished,
  running or waiting extraction job is skipped, so nothing is read twice; a failed one is tried again. It shows
  progress and the file being read, waits out a rate limit (the wait the server names, or 2, 4 and 8 seconds), and
  has a Stop button. A stopped run leaves the rest for the next one, and the summary links to the workbench. Files
  are read one at a time because each is a long model job. No new server route and no migration.

### Review workbench: snip a value straight into the facts ledger

- **Snip from the document panel.** The workbench's left panel has "Open any uploaded document", a list of every
  PDF and image in the engagement, not only those the model read. Draw a box around a value; a form then appears
  to name the field (a dropdown of the fields the methodology binds), type the figure and say what is printed in the
  box. "Add to facts ledger" records it at once. The panel opens ready to snip when nothing was extracted.
- **Recorded as a fact, marked as entered by you.** The reviewer drew the box, named the field and typed the figure,
  so that is the decision: the field is stored accepted by them and the fact is written with its page, region and
  printed text. It is marked as drawn by a person (`provenance.kind = snip`, `proposed_by`), shown as "Entered
  from the page", and audited as `field.snipped_accepted`. Only fields the methodology binds can be added and the
  figure must be a number. Because no second person sees it first, the independent technical review is the check
  on it. No migration.
- The drag-to-draw layer is shared with the desk-review snip dialog.

### Website assistant: guardrails, current knowledge and a plainer panel

Decision record: [0024](docs/decisions/0024-website-assistant-guardrails.md).

- **Screening before anything else.** Messages that try to change the assistant's rules, reveal its prompt or
  assign it a role are refused. Messages carrying an ID or card number, an access key or a password are refused.
  Neither kind is retrieved or sent to a model. Email addresses and phone numbers are removed from what is kept.
- **Scope that cannot be borrowed.** A loose match (for example "what's the best phone?") is never answered from
  the library alone; the model may judge it, or the question is refused. A follow-up takes the previous question
  only when it has no words of its own, so an off-topic request cannot inherit the product topic.
- **Stricter grounding.** A model's wording is shown only if at least 60% of its words come from the entries it
  cites, and it does not talk about its own instructions.
- **Knowledge brought up to date.** Entries now cover the desk review and its decisions, the evidence checklist,
  reading pro forma inputs, the review queue, calculation readiness, DPR measures and savings, starting an
  engagement, document-type suggestions, what is not yet available, and where to get help. Two claims were
  corrected: extraction sends PDF pages and images to Gemini, and ECM is not ADEETIE-only. Tests check each
  entry's routing, that every link is a real page, and that no entry states a scheme threshold.
- **A plainer panel.** Three starter questions, one link per reply, one line of disclaimer. The topics toggle,
  the avatars and the extra header controls are gone.
- **Route.** Responses are `no-store`. The log records the outcome and mode, never the question or the answer.

### Desk review: real PDF reading, period-aware calcination, NABL band, stronger integrity checks

Found by running the Dataset-2 engagement end to end. No engine or pack version changes: the run input and
its hash are unchanged for any year and any supplied figure.

- **Suggestions come from the PDF.** "Suggest from documents" used to return fixed numbers from the Shyamrock
  fixture, so it could never see a fault in the PDFs actually uploaded. It now reads each PDF's text layer
  (`pdfjs-dist`, no model) and applies a labelled-row extractor per reading. A figure is suggested only when its
  row is found; the auditor still accepts or edits it. A PDF with no text layer (a scan) is named as unreadable
  and nothing is guessed. The route needs `review.decide`, takes PDFs up to 25 MB, and names what it skipped.
- **Calcination follows the intensity basis.** Section 3.4(1) Note (p. 7) sets the 2024-27 targets on direct
  energy and indirect emissions and defers process emissions. A cement run no longer returns a 422 for a missing
  calcination figure when the compliance year is FY2024-25 to FY2026-27. A figure the plant does supply is still
  counted, and the run says so in a warning, so no number changes on an interpretation. Outside that window, or
  when the year cannot be read, the figure is required as before. Pack streams gained `basisWindow`.
- **The two calcination methods are alternatives.** A run needs one of them (`requiredGroup`) and refuses both,
  which would count the process CO2 twice. The runs page says what was left out of the basis for the year.
- **NABL band enforced.** `gcv_nabl_corroboration` fails when internal and NABL coal GCV differ by 71.7 kcal/kg
  or more, cited to Clause 4(10)(ii)-(iii), p. 14. It reports the clause remedy and does not apply it.
- **Formula integrity.** The pro forma is checked against the template for the layout it matches, which removes
  false positives on other layouts and catches formulas overwritten with typed values on later sheets.
- **Evidence period.** New `evidence_period` check: a dated series that reaches outside the compliance year
  fails. Data from FY2023-24 now says so against an FY2026-27 engagement.
- **Documents tab.** A file that sits in an evidence slot but has no page type now reads "In slot: …" and not
  "Not classified". The checklist counts the slot, so the two views no longer look contradictory.
- Register: section 9 records the open readings (the "2024-27" window, whether achieved intensity should also
  exclude process emissions, the sign and cadence of the NABL difference, other sectors).

### Documents: suggest a type for every unassigned file, in batches

- **One button.** "Suggest types for all unassigned" on the Documents tab names every PDF, PNG and JPEG that has
  no type yet. It shows progress, waits out a rate limit, and has a Stop button; a stopped run leaves the rest
  for the next one. A type that is already set, by hand or earlier, is never changed, even if someone sets one
  while the model is working.
- **Batches sized to the limits.** One model call carries the first page of up to 8 files and returns a type for
  each, so thirty files take four calls. A call is capped at 9 MB of page data (about 12 MB on the wire, under
  the model's inline cap). The server decides what fits and hands the rest back for the next call, so a browser
  cannot overrun it. A first page over 12 MB, a WebP and spreadsheets are named in the summary and not sent.
- **What is sent.** The first page of each file as data, and the methodology's document types. No filename or other
  metadata. Each call is recorded in `ai_action_logs` (`classify_batch`, with the input hash) and in the audit log
  (`documents.classified_batch`).
- **A suggestion is not a decision.** The type is saved with the model's confidence, shown on the row as before.
  The evidence slot follows only when confidence is 0.9 or more, the same floor extraction uses for review, so
  an unsure suggestion does not mark a checklist slot as filled.
- Calls count against the existing per-user model-call limit (30 a minute). A busy or rate-limited model is retried
  after the wait it names, or 2, 4 and 8 seconds. No migration.

### Desk review: findings, the lead schedule, snips and the binder

- **One clause registry.** The desk review cites each check to the clause in the register (stock balance,
  completeness, sampling, NCV basis, materiality, renewable claims, export deduction). A check with no clause of
  its own is cited to the procedure as a whole and says so; no clause number is invented. The register notes the
  owner's confirmation. See `backend/domain/deskreview/clauses.ts`.
- **Raise a finding in one step, built on the server.** `POST /api/desk-review/raise-finding` takes only the
  engagement and the check. The title, figures, clause, size of the gap, required response and evidence references
  come from the latest saved run and the registry, and a finding already stored for the check is not duplicated.
  Runs and decisions store the same fields. `/api/findings/create`, which trusted browser-supplied text and did
  not check the engagement's organization, is removed.
- **The lead schedule is built by one function.** `buildLeadSchedule` takes the desk-review results and gives
  each line its reported and evidenced figures, the difference, the band, the clause and the decision, and the
  aggregate position against 2% of the reported total. The page and the binder read the same structure. It never
  calls a line material and never says verified. The previous schedule pointed at checks that no longer exist
  (`coal_log_vs_po`, `gcv_rule`) and labelled any pass "within 0.5%".
- **Snip a figure from the page.** Draw a box on the page a typed figure was read from, say what is printed in
  it, and the box is kept with the value (normalised to the page, as extraction does). A snip is human provenance;
  nothing reads the box for the auditor. Migration 0020 adds `bbox`, `source_text` and `source_kind` to
  `desk_readings`.
- **A binder.** `GET /api/desk-review/binder?engagementId=` returns a PDF with the cover and content digest, the
  lead schedule, the aggregate, the findings and decisions, an index of every figure with its file hash and page,
  cell or region, and the cited pages with each snipped region drawn on. The same content gives the same bytes. The
  file's SHA-256 and the digest are written to the audit log (`desk_review.binder_generated`) and returned in
  `X-Binder-SHA256` and `X-Binder-Content-Digest`. The layout is generic.

### A new look for the public site and the shared components

- **Public home page rebuilt.** The hero is a live fragment: press a value on an invoice page, then accept or
  correct it, and it becomes a fact with a name and an identifier. Below it, one engagement pinned beside six
  statements and changing state, an index of five output documents, the principles as a large-type list, schemes,
  a dark trust band, a question index and the demo form on a colour field. All copy and claims are the existing
  ones. The fragments are synthetic and say so.
- **Shared tokens.** `mist` is now a warm stone scale and `teal` a grey-green moss, so every screen takes the
  new palette. The gradient wash, grain, frosted glass, resting shadows, gradient buttons, monospace labels and
  the serif accent are gone. Panels are a tone step with a quiet edge; shadows are kept for menus and dialogs.
  Buttons are one flat fill with a 6px corner (square on the public site). Corner radii are smaller.
- **Auth and legal pages** use the same frame and type. The header, footer and demo form follow.
- **One photograph**, a limestone quarry and cement works (CC BY 2.0, credited in the footer).
- No behaviour, route or data changes. App screens could not be previewed without a Supabase connection.

### Desk review: messy files and checks that prove value

- **Dates and headers.** Workbook dates are read in ISO, day-first (`15/11/2023`, `15-11-2023`), named-month
  (`15-Nov-23`) and Excel serial forms; `31/02` is not a date. The date column is found wherever it sits
  (left-most on a tie), so a serial-number column in A no longer hides it. A header matches ignoring case and
  a unit only when the units agree (`(kg)` is not `(t)`).
- **Nothing is dropped or replaced silently.** Reading notes now say when a row holds a figure but no
  readable date, when a date repeats, when dated rows are empty, and when a later file or sheet replaces a
  different figure from an earlier one. Files are read in a fixed order. A dated row with no value is no
  longer counted as zero output or as a month of evidence.
- **Coverage checks prove value.** Twelve months of evidence now also needs a total that matches the annual
  cell within 0.5%, no month far thinner than the series' typical month, and no evidence beyond the
  period. `DPR vs SCADA` uses the shared daily check.
- **Typed PDF figures need a source.** Saving a figure requires its document and page, and the audit entry
  keeps the replaced or removed value. Figures are marked as typed by an auditor, with the date.
- **Show working.** Each check expands to its inputs (value, unit, document, cell or page, and how it was
  read), found against compared-with, difference and the allowed band. A summary line counts checks,
  notes and typed figures. Working defaults are listed in the regulatory register, section 10, and stay
  unverified. No migration.

### Removing an uploaded document

- **Remove** button on the Documents tab (`documents.upload`), with a confirmation. A file can go while
  nothing accepted rests on it; the server refuses, and says why, when an accepted fact, a reviewed
  extraction, a declared figure or a desk-review reading cites it, when the engagement is at sign-off or
  submitted, or when the file came from the entity's response link or fieldwork. Shared bytes are deleted
  only when no other document uses them. Audit action `document.removed`. See ADR 0023. No migration.

### Desk review: fuel oil stream, evidence trail and decisions

- **Cement pack: fuel oil is a stream.** `furnace-oil` (optional) binds `furnaceOil.quantity` and
  `furnaceOil.calorificValue`, read from the pro forma's GHG sheet, priced with `ef_furnace_oil`
  (IPCC 2006, `verified:false`). The desk review's Form 1, workbook and materiality checks now compare
  against coal plus fuel oil instead of reporting fuel oil as a misstatement. A cement run with fuel-oil
  facts now includes the stream, so its result differs from earlier runs on the same plant.
- **Each check shows where its figures came from.** Every desk-review outcome lists the readings it used
  with value, unit, document and cell or PDF page (`DeskOutcome.sources`), linked to the file. The same
  lines are written to the finding's `evidence_refs` and shown on the Findings page.
- **Materiality and completeness strip** at the top of the page: reported total, 2% threshold, quantified
  misstatement, what the total could not count (calcination, petcoke), and which evidence slots are
  missing or cover fewer than 12 months.
- **Decisions on each check.** Accept with explanation, unresolved immaterial, unresolved material, scope
  limitation (`POST /api/desk-review/resolve`). Material and scope limitation raise the linked finding to
  block, so sign-off waits; accepting with an explanation walks the finding to closed through the
  lifecycle and logs the reason as a verifier response. A check that agrees on re-run is marked resolved
  by code. Migration `0019_desk_resolutions.sql`; apply it before deciding checks.

### Desk review and pro forma inputs

- **Desk review** (new engagement page, `review.decide`). A rule engine over the evidence in its slots.
  Workbook figures (SCADA, CPP, fuel log, coal lab, pro forma) are read by code; PDF figures are typed
  by the auditor against a document and page (`desk_readings`). A rule with a missing figure is pending,
  never passed. Each run is saved with every reading it saw (`desk_reviews`). Migration `0018`.
- **Run inputs from the pro forma only.** The cement pack declares `proforma_inputs` (label, sheet, unit,
  scale). A new formula evaluator recomputes the workbook, so formula cells stored as 0 read correctly.
  "Read inputs" on the pro forma document commits them as facts that point at the cell.
- **Engine.** A fuel with a quantity but no calorific value now blocks the run and throws, instead of being
  dropped silently. Streams with no facts stay optional and are listed as counted as zero.

### Changed: evidence packages and spreadsheet totals (ADR 0022)

- **A manifest is optional.** A ZIP with no usable `manifest.json` imports its PDFs, images, Excel and CSV files
  directly, and hashes each on receipt. A manifest's hash mismatch no longer blocks the import: the file is
  imported, flagged, and written to the audit log (`evidence_pack.hash_mismatch`). Unlisted or unsupported
  entries are reported as skipped. The ZIP error for a plain folder is gone.
- **Totals review.** Each spreadsheet or CSV has a Review totals action. Totals are found on upload, recomputed
  from the stored file, and shown beside the workbook's stored value. The auditor edits the metric, tag, unit
  and value, then approves. Approved totals are committed as decided extractions and facts with spreadsheet-cell
  provenance, plus the label and the period the rows cover. A tag already in the ledger is refused.
- **Totals without a total row.** A table with a header row and numbers but no total row gets its totals
  summed on review, one per additive column, named by the column header. Rate, ratio, percentage, quality and
  identifier columns are not summed. Such a total is recorded with the new provenance type
  `spreadsheet_range`. Migration `0017_spreadsheet_range_provenance.sql` must be applied.
- **Upload** takes several files at once and stores them only. Reading stays a separate step.
- **Restored intake work.** Tracked edits from the evidence checklist, the run gate and the click-to-map
  mapper had been reverted in the working tree and were re-applied: `evidence_slots` on the cement pack,
  `documents.slot`, the checklist panel, the run gate, and the workbook-only run filter (off by default).

### Changed: app navigation feel

- Per-request memoisation of `getSession` / `getEngagement` in Server Components, so shell,
  engagement layout and the page share one auth and engagement read.
- Engagement Overview loads ADEETIE panels, savings and stages in parallel; ECM reuses that
  engagement (and runs when already loaded).
- Mutations soft-refresh with `router.refresh()` instead of a full browser reload.
- Engagement-route loading skeleton; short client-router `staleTimes` for tab switches.
- Proxy skips `auth.getUser()` when no Supabase auth cookie is present (anonymous traffic),
  and also on signed-in app navigations (the single `getUser()` is in `getSession()`).
- Engagement and sidebar nav highlight instantly on click; tab links use `prefetch={false}`.
- Soft refresh after mutations runs inside `useTransition` so buttons stay busy until the
  RSC update lands.
- ECM library load is scoped to the pack sector; same match rules as before.
- Migration `0015_engagement_query_indexes.sql` adds engagement_id indexes on hot tables.
  Auth rules, pack behaviour and user-visible outcomes are unchanged.

### Changed: public site and visual language

- **Landing page** rewritten to cover the whole workflow: planning, four evidence types,
  declared-vs-extracted, sampling and bulk accept, fieldwork, issue lifecycle with entity links,
  technical review, the submission package, portfolio import, savings, trust, and an expanded FAQ.
  CBAM and green hydrogen are shown as "in design", not as products.
- **New pages:** `/terms`, `/security`, `/licenses`; `/privacy` rewritten to match what the product
  does today. The terms have not been reviewed by counsel.
- **Footer** with product, scheme and legal links, a regulator-independence disclaimer and an
  optional contact address (`NEXT_PUBLIC_CONTACT_EMAIL`).
- **Typography and surface.** Instrument Sans, Instrument Serif (display accents) and JetBrains
  Mono replace Geist. Panels, the app shell and the assistant use frosted glass over a quiet
  ambient background. Corner radii are larger. No behaviour changes.

### Added: DFD v3.1
Migrations `0013_provenance_v2.sql` and `0014_dfd_v31.sql` must be applied. No engine version
changes: the GEI and SEC engines and every pack calculation are untouched. `SAVINGS_DPR`
(`savings-dpr-1.0.0`) is a new, separate layer.

- **Provenance v2.** A fact may be sourced from a document page, a spreadsheet cell, a time-series
  range or a site observation. Page evidence keeps its original columns.
- **Intake.** XLSX and CSV uploads (including SCADA time series) are parsed before storing and
  indexed as datasets; cells and ranges are mapped to proposals the server re-reads; an evidence
  pack (`.zip` with a manifest) imports files and declared values; images get a header-based
  quality check.
- **Declared vs extracted.** What the entity declared is compared with what was read, kept apart
  from facts.
- **Sampling-aware triage and audited bulk accept.** Low-risk values can be accepted in bulk only
  after a deterministic review sample is clean. Each batch is recorded; reports disclose the share.
- **Verification planning (13.0).** Risk factors, sampling rate and site-visit decision, saved as
  immutable versions.
- **Fieldwork (14.0).** Site visits and observations with idempotent, offline-capable capture; an
  observation needs someone other than its recorder to accept it.
- **Issue lifecycle (7.0).** Findings are opened with the entity, answered through a signed
  one-time link at `/respond/[token]`, verified and closed. `block` issues cannot skip the response.
- **Technical review (8.4).** The independent reviewer approves or requests changes, bound to a
  snapshot; a stale approval does not count and a request for changes blocks sign-off.
- **Submission package (8.7).** A deterministic ZIP with a hashed manifest. Its layout is generic
  and says so.
- **Bulk import and stage manager (1.0).** Import engagements from CSV or XLSX with a dry run;
  ADEETIE engagements track a stage.
- **Savings and payback.** A `SAVINGS_DPR` layer over the recorded measures, with an optional
  rupee saving per measure.
- **Structure only.** CBAM (`EMBEDDED_EMISSIONS`) and green hydrogen (`H2_INTENSITY`) are
  described but not implemented, and refuse to run.
- ADRs 0015 to 0021; open items recorded in the regulatory register (sections 9 and 10).

### Changed
- Closing a block finding now needs the response path (open, respond, verify, close). Closing a
  block issue directly from the sign-off page was removed; the page links to the findings.
- Sign-off is held when a technical review asked for changes, or is required and missing or stale.
- Repository reorganised: documentation moved to `docs/`; `backend/demo/` renamed
  `backend/fixtures/`; CCTS packs grouped under `packs/ccts/`; `units` and `factors` became
  folders; the citation ingest CLI moved to `backend/scripts/`. No behaviour change.
- New npm scripts: `citations:ingest`, `supabase:probe`, `e2e:firm`, `e2e:flow`.

### Added
- Architecture overview, decision records, glossary, regulatory register, contributing guide,
  security policy and this changelog.
- Frontend redesign: teal-on-white design system (`mist` neutrals), logo and app icon, grouped
  sidebar with user menu, engagement tabs and breadcrumbs, split-screen sign-in with the new-firm
  role picker behind a toggle, and a rebuilt landing page. Presentation only; no calculation,
  capability or data-flow change.
- Landing-page demo request: `POST /api/demo-request` emails `DEMO_REQUEST_TO` through Resend,
  rate limited per IP and per email, with a honeypot field. Nothing is stored.
- Website assistant: a chat launcher at the bottom right of every page, backed by
  `POST /api/assistant`. It answers only from the curated entries in
  `backend/domain/assistant/knowledge.ts`. Questions that match no entry are refused before any
  model call. Gemini only rephrases the matched entries, and its answer is discarded in favour of
  the entry text if it cites anything it was not given or adds a number or link. Works without
  `GEMINI_API_KEY` by showing the entry text. Rate limited per IP, with a per-instance daily
  model budget. Reads no tenant data and stores nothing. Toasts moved up to clear the launcher.

### Removed
- Unused components (draft-mode toggle, seed-demo button, ECM library notice, public workbench
  component) and Next.js template images.

### Security
- Migration `0012_server_only_writes.sql`: signed-in users can read their organisation's rows
  but no longer write any table directly through PostgREST. Runs, sign-offs, facts, factor
  verifications and audit events are append-only by trigger. Audit events record the acting
  user through `append_audit_event_as()`; the old RPC is no longer callable by users.
- Factor verification writes through the server after the steward check.
- An invite no longer resets the password of an existing confirmed account.
- Invite tokens prefer `INVITE_SIGNING_SECRET`; email links use `APP_URL` or the request URL,
  never the `Origin` header.
- First Google sign-in is subject to the signup gate.
- Engagements can no longer be set to `submitted`, or skip a status step, through the status
  endpoint.
- Evidence uploads are typed by content (PDF, PNG, JPEG, WebP only), capped at 50 MB, and
  refused if truncated. The proxy body limit is raised so files over 10 MB are no longer stored
  cut short. Evidence downloads send `nosniff` and a safe `Content-Disposition`.
- Rate limits on signup, invite lookup, invites, firm creation and model-calling routes; length
  caps on request fields; generic error messages in production.
- Security headers on every response and a cross-site check on `/api` writes in `proxy.ts`.

## 2026-09-21

### Changed
- Self-serve signup sends a confirmation email through Resend before the account can sign in.
- Invite email delivery fixed.

## 2026-09-06

### Added
- Invite emails through Resend, and a copy button for invite links on the Team page.

### Removed
- Google sign-up button on the create-account page (Google sign-in remains on login).

## 2026-09-05

### Added
- Regulatory Citation Assistant: pgvector corpus, scheme- and sector-filtered retrieval,
  groundedness gate, accept / edit / reject on findings (migration `0010`).
- ECM suggestions: deterministic matching against `ecm_library`, grounded restyling (migration
  `0011`).
- Signed invite tokens; invitees create their account with a password at `/signup?invite=…`.

### Changed
- Runs proceed with unverified factors and list them as warnings, instead of requiring draft
  mode. New engagements start with draft mode off, and the toggle is no longer shown.
- Firms no longer attest factors; only platform stewards cite or correct them.
- Self-serve signup no longer offers a role choice; it creates a firm admin.

### Removed
- Demo seeding (`/api/engagements/[id]/seed-demo` returns 410) and the public `/workbench` demo
  (now redirects to `/login`).

## 2026-09-02

### Added
- Capability-based access control for the four roles, enforced in nav, pages and routes.
- Platform steward role for reference factors (`VERIFYSTACK_STEWARD_EMAILS`).
- Team page with invites and role changes.
- Self-serve signup policy, Google sign-in, password recovery and update.
- ADEETIE Foundry sector and cluster distance (migration `0009`).

## 2026-08-31

### Added
- Verifier application as a `backend/` + `frontend/` workspace monorepo: engagements, hashed
  evidence intake, Gemini extraction with provenance, review workbench, hash-chained runs,
  findings, maker–checker sign-off, PDF reports, Supabase schema and RLS (migrations
  `0001`–`0008`), CI.
- ADEETIE: SEC engine, clusters, and the IGEA → DPR → M&V lifecycle with measures.

## 2026-08-22

### Added
- Deterministic verification core: units, factor catalogue, GEI engine, reconciliation rules,
  extraction scaffolding.
