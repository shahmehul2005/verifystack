/**
 * The sealed audit binder: a PDF an engagement reviewer can read without the
 * product. It holds the lead tie-out schedule, the findings and the decisions on
 * them, an index of every figure the checks rest on (with the file, its SHA-256
 * and the page, cell or region it came from), and the cited pages themselves
 * with each snipped region drawn on.
 *
 * Deterministic: the same inputs and the same `generatedAt` give the same bytes,
 * so a reviewer can rebuild it and compare. The cover prints a content digest
 * over what the binder asserts. The SHA-256 of the finished file cannot be
 * printed inside itself, so the route records it in the audit log and returns it
 * in a header.
 *
 * The layout is generic. No regulator has supplied a submission format.
 */

import { createHash } from "node:crypto";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { DeskSourceRef } from "../deskreview/engine";
import { LEAD_STATUS_LABEL, type LeadSchedule } from "../deskreview/leadSchedule";
import { RESOLUTION_LABEL, type ResolutionState } from "../deskreview/resolution";
import { describeRegion, type Region } from "../deskreview/snip";

export interface BinderFinding {
  ruleId: string;
  title: string;
  severity: string;
  state: string;
  clauseRef: string;
  detail: string;
  requiredResponse: string | null;
  magnitude: { value: number; unit: string } | null;
}

export interface BinderDocument {
  id: string;
  filename: string;
  sha256: string;
  mimeType: string;
  /** The stored bytes, when the evidence page should be bound into the appendix. */
  bytes?: Uint8Array | null;
}

export interface BinderSignoff {
  role: string;
  attestorName: string;
  statement: string;
  at: string;
  reportHash: string;
}

export interface BinderInput {
  /**
   * Written into the file's metadata. Pass the time the content was last changed, not the
   * time of the request, so downloading the same content twice gives the same bytes.
   */
  generatedAt: string;
  engagement: { id: string; clientName: string; plantName: string | null; packId: string; packVersion: string; complianceYear: string };
  run: { id: string; at: string };
  schedule: LeadSchedule;
  findings: BinderFinding[];
  documents: BinderDocument[];
  signoffs: BinderSignoff[];
  /** Notes the readers left on the run: rows left out, files that replaced others. */
  notes: string[];
  /** The most evidence pages bound in. Pages beyond it are listed but not included. */
  maxEvidencePages?: number;
}

export interface Assertion {
  key: string;
  label: string;
  value: string;
  unit: string | null;
  kind: "workbook" | "typed" | "snip" | "unknown";
  documentId: string | null;
  filename: string | null;
  sha256: string | null;
  location: string | null;
  page: number | null;
  region: Region | null;
  sourceText: string | null;
  enteredAt: string | null;
}

export interface BinderResult {
  bytes: Uint8Array;
  /** SHA-256 over what the binder asserts, printed on its cover. */
  contentDigest: string;
  pages: number;
  evidencePages: number;
  /** Cited pages that were not bound in, with the reason. */
  notBound: string[];
}

/* ------------------------------------------------------------------ */
/* Digest                                                              */
/* ------------------------------------------------------------------ */

/** JSON with sorted keys, so the same content always gives the same text. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const o = value as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
    .join(",")}}`;
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

const pageOf = (location: string | null): number | null => {
  const m = /^p\. (\d+)$/.exec(location ?? "");
  return m ? Number(m[1]) : null;
};

/** Every figure the checks used, once each, in a fixed order. */
export function collectAssertions(schedule: LeadSchedule, documents: BinderDocument[]): Assertion[] {
  const docs = new Map(documents.map((d) => [d.id, d]));
  const seen = new Map<string, Assertion>();
  for (const row of schedule.rows) {
    for (const s of row.sources as DeskSourceRef[]) {
      const doc = s.documentId ? docs.get(s.documentId) : undefined;
      const id = `${s.key}|${s.documentId ?? s.filename ?? ""}|${s.location ?? ""}`;
      if (seen.has(id)) continue;
      seen.set(id, {
        key: s.key,
        label: s.label,
        value: typeof s.value === "number" ? String(Math.round(s.value * 1e6) / 1e6) : String(s.value),
        unit: s.unit ?? null,
        kind: s.kind ?? "unknown",
        documentId: s.documentId ?? null,
        filename: doc?.filename ?? s.filename ?? null,
        sha256: doc?.sha256 ?? null,
        location: s.location ?? null,
        page: pageOf(s.location ?? null),
        region: s.region ?? null,
        sourceText: s.sourceText ?? null,
        enteredAt: s.enteredAt ?? null,
      });
    }
  }
  return [...seen.values()].sort((a, b) => a.key.localeCompare(b.key) || (a.location ?? "").localeCompare(b.location ?? ""));
}

export function contentDigestOf(input: BinderInput, assertions: Assertion[]): string {
  return sha256(
    stableStringify({
      engagement: input.engagement.id,
      run: input.run.id,
      rows: input.schedule.rows.map((r) => ({
        ruleId: r.ruleId,
        declared: r.declared,
        evidenced: r.evidenced,
        variance: r.variance,
        status: r.status,
        decision: r.decision?.state ?? null,
      })),
      aggregate: input.schedule.aggregate,
      findings: input.findings.map((f) => ({ ruleId: f.ruleId, severity: f.severity, state: f.state, clauseRef: f.clauseRef, magnitude: f.magnitude })),
      assertions: assertions.map((a) => ({ key: a.key, value: a.value, sha256: a.sha256, location: a.location, region: a.region, sourceText: a.sourceText })),
      signoffs: input.signoffs.map((s) => ({ role: s.role, name: s.attestorName, hash: s.reportHash })),
    })
  );
}

/* ------------------------------------------------------------------ */
/* Drawing                                                             */
/* ------------------------------------------------------------------ */

const W = 595.28;
const H = 841.89;
const M = 44;
const INK = rgb(0.15, 0.15, 0.15);
const MUTED = rgb(0.4, 0.4, 0.4);
const SHADE = rgb(0.92, 0.92, 0.91);
const AMBER = rgb(0.85, 0.55, 0.05);

const REPLACEMENTS: Record<string, string> = {
  "Δ": "Delta",
  "≤": "<=",
  "≥": ">=",
  "−": "-",
  "→": "->",
  "←": "<-",
  "₂": "2",
  "′": "'",
  " ": " ",
  " ": " ",
  " ": " ",
  "‑": "-",
};

class Writer {
  page!: PDFPage;
  y = 0;
  private readonly set: Set<number>;

  constructor(
    readonly pdf: PDFDocument,
    readonly font: PDFFont,
    readonly bold: PDFFont
  ) {
    this.set = new Set(font.getCharacterSet());
    this.newPage();
  }

  safe(text: string): string {
    let out = "";
    for (const ch of text.replace(/\s+/g, " ")) {
      const cp = ch.codePointAt(0)!;
      out += this.set.has(cp) ? ch : (REPLACEMENTS[ch] ?? "?");
    }
    return out;
  }

  newPage() {
    this.page = this.pdf.addPage([W, H]);
    this.y = H - M;
  }

  ensure(height: number) {
    if (this.y - height < M + 28) this.newPage();
  }

  wrap(text: string, size: number, font: PDFFont, width: number): string[] {
    const lines: string[] = [];
    let line = "";
    for (const rawWord of this.safe(text).split(" ")) {
      let word = rawWord;
      while (font.widthOfTextAtSize(word, size) > width) {
        let cut = word.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(word.slice(0, cut), size) > width) cut -= 1;
        if (line) {
          lines.push(line);
          line = "";
        }
        lines.push(word.slice(0, cut));
        word = word.slice(cut);
      }
      const next = line ? `${line} ${word}` : word;
      if (line && font.widthOfTextAtSize(next, size) > width) {
        lines.push(line);
        line = word;
      } else {
        line = next;
      }
    }
    if (line) lines.push(line);
    return lines.length ? lines : [""];
  }

  para(text: string, o: { size?: number; bold?: boolean; indent?: number; gap?: number; color?: ReturnType<typeof rgb> } = {}) {
    const size = o.size ?? 10;
    const font = o.bold ? this.bold : this.font;
    const indent = o.indent ?? 0;
    for (const line of this.wrap(text, size, font, W - 2 * M - indent)) {
      this.ensure(size + 3);
      this.page.drawText(line, { x: M + indent, y: this.y - size, size, font, color: o.color ?? INK });
      this.y -= size + 3;
    }
    this.y -= o.gap ?? 4;
  }

  heading(text: string, size = 15) {
    this.ensure(size + 16);
    this.y -= 8;
    this.para(text, { size, bold: true, gap: 6 });
  }

  table(cols: { title: string; width: number; align?: "right" }[], rows: string[][], size = 8) {
    const pad = 3;
    const lead = size + 2;
    const header = () => {
      this.ensure(lead + 8);
      let x = M;
      this.page.drawRectangle({ x: M, y: this.y - lead - 4, width: W - 2 * M, height: lead + 6, color: SHADE });
      for (const c of cols) {
        this.page.drawText(this.safe(c.title), { x: x + pad, y: this.y - lead, size, font: this.bold, color: INK });
        x += c.width;
      }
      this.y -= lead + 8;
    };
    header();
    for (const row of rows) {
      const cells = row.map((cell, i) => this.wrap(cell, size, this.font, cols[i]!.width - 2 * pad));
      const lines = Math.max(...cells.map((c) => c.length));
      const height = lines * lead + 6;
      if (this.y - height < M + 28) {
        this.newPage();
        header();
      }
      let x = M;
      cells.forEach((cell, i) => {
        const col = cols[i]!;
        cell.forEach((line, n) => {
          const w = this.font.widthOfTextAtSize(line, size);
          const tx = col.align === "right" ? x + col.width - pad - w : x + pad;
          this.page.drawText(line, { x: tx, y: this.y - lead * (n + 1) + 1, size, font: this.font, color: INK });
        });
        x += col.width;
      });
      this.y -= height;
      this.page.drawLine({ start: { x: M, y: this.y + 2 }, end: { x: W - M, y: this.y + 2 }, thickness: 0.25, color: SHADE });
    }
    this.y -= 6;
  }
}

const num = (n: number | null, digits = 3) =>
  n === null ? "-" : n.toLocaleString("en-IN", { maximumFractionDigits: digits });
const signed = (n: number | null) => (n === null ? "-" : n > 0 ? `+${num(n)}` : num(n));

const FIXED_DATE = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? new Date(0) : d;
};

/* ------------------------------------------------------------------ */
/* Build                                                               */
/* ------------------------------------------------------------------ */

export async function buildBinder(input: BinderInput): Promise<BinderResult> {
  const assertions = collectAssertions(input.schedule, input.documents);
  const contentDigest = contentDigestOf(input, assertions);

  const pdf = await PDFDocument.create({ updateMetadata: false });
  pdf.setTitle(`Desk review binder, ${input.engagement.clientName}`);
  pdf.setAuthor("VerifyStack");
  pdf.setCreator("VerifyStack");
  pdf.setProducer("VerifyStack binder v1");
  pdf.setSubject(`Engagement ${input.engagement.id}, run ${input.run.id}`);
  pdf.setKeywords(["desk review", "binder", `sha256:${contentDigest}`]);
  const generated = FIXED_DATE(input.generatedAt);
  pdf.setCreationDate(generated);
  pdf.setModificationDate(generated);

  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const w = new Writer(pdf, font, bold);
  const { schedule } = input;

  // ---- Cover ----
  w.y -= 60;
  w.para("Desk review binder", { size: 26, bold: true, gap: 10 });
  w.para(input.engagement.clientName + (input.engagement.plantName ? `, ${input.engagement.plantName}` : ""), { size: 14, gap: 4 });
  w.para(`${input.engagement.packId} (version ${input.engagement.packVersion}) · compliance year ${input.engagement.complianceYear}`, { size: 11, color: MUTED, gap: 24 });
  w.para("What this binder holds", { bold: true, size: 11 });
  w.para(`The lead tie-out schedule (${schedule.rows.length} checks: ${schedule.counts.agrees} agree, ${schedule.counts.disagrees} disagree, ${schedule.counts.waiting} waiting for readings, ${schedule.counts.undecided} cannot be decided), the aggregate position, ${input.findings.length} finding(s) with their decisions, an index of ${assertions.length} figure(s) with their sources, and the cited evidence pages.`, { size: 10, gap: 14 });
  w.para("Run", { bold: true, size: 11 });
  w.para(`Desk review run ${input.run.id}, saved ${input.run.at}.`, { size: 10, gap: 14 });
  w.para("Content digest (SHA-256)", { bold: true, size: 11 });
  w.para(contentDigest, { size: 9, gap: 4 });
  w.para("The digest is over what this binder asserts: the schedule, the aggregate, the findings, the sign-offs and every figure with its source. Rebuild the binder from the same run and it must match. The SHA-256 of the finished file is recorded in the audit log when the binder is generated.", { size: 9, color: MUTED, gap: 14 });
  w.para("Layout", { bold: true, size: 11 });
  w.para("This is a generic layout. No regulator has supplied a submission format for this scheme, so nothing here is presented as one.", { size: 10, gap: 14 });
  if (input.signoffs.length > 0) {
    w.para("Sign-offs recorded", { bold: true, size: 11 });
    for (const s of input.signoffs) w.para(`${s.attestorName}, ${s.role}, ${s.at}. Report hash ${s.reportHash.slice(0, 16)}...`, { size: 10, gap: 2 });
  } else {
    w.para("Sign-offs", { bold: true, size: 11 });
    w.para("No sign-off is recorded for this engagement yet. This binder is a working binder, not a sealed submission.", { size: 10 });
  }

  // ---- Lead schedule ----
  w.newPage();
  w.heading("Lead tie-out schedule");
  w.para("Each figure the entity reported, set against what the evidence shows. A line that agrees is within the band its check allows. Whether the total is material is judged on the aggregate, below, not line by line.", { size: 9, color: MUTED });
  const decisionText = (state: string | undefined) => (state ? (RESOLUTION_LABEL[state as ResolutionState] ?? state) : "");
  w.table(
    [
      { title: "Check", width: 178 },
      { title: "Reported", width: 66, align: "right" },
      { title: "Evidenced", width: 66, align: "right" },
      { title: "Difference", width: 62, align: "right" },
      { title: "Result", width: 62 },
      { title: "Decision", width: 73 },
    ],
    schedule.rows.map((r) => [
      `${r.label} (${r.clause.specific ? r.clause.ref.split(" — ")[0] : "no single clause"}${r.clause.specific && !r.clause.verified ? ", to be confirmed" : ""})`,
      r.declared === null ? "-" : `${num(r.declared)} ${r.unit}`,
      r.evidenced === null ? "-" : `${num(r.evidenced)} ${r.unit}`,
      r.variance === null ? "-" : `${signed(r.variance)}${r.variancePct !== null ? ` (${num(r.variancePct, 2)}%)` : ""}`,
      LEAD_STATUS_LABEL[r.status],
      decisionText(r.decision?.state) || (r.status === "disagrees" || r.status === "waiting" ? "Not decided" : ""),
    ])
  );
  if (schedule.undecided > 0) w.para(`${schedule.undecided} line(s) disagree or wait for readings and carry no decision.`, { size: 9, bold: true });

  const a = schedule.aggregate;
  w.heading("Aggregate position", 12);
  if (a) {
    w.para(`Reported total ${num(a.reportedTotal, 1)} tCO2e. ${a.fraction * 100}% of that is ${num(a.threshold, 1)} tCO2e. Quantified misstatements sum to ${num(a.quantified, 1)} tCO2e, which is ${a.over ? "over" : "within"} the threshold.`, { size: 10 });
    for (const l of a.limitations) w.para(`The total is incomplete: ${l}`, { size: 9, indent: 10, gap: 2 });
  } else {
    w.para("The pro forma was not read in this run, so there is no aggregate position.", { size: 10 });
  }

  // ---- Findings ----
  w.heading("Findings and decisions");
  if (input.findings.length === 0) w.para("No finding has been raised.", { size: 10 });
  for (const f of input.findings) {
    w.ensure(70);
    w.para(`${f.title} (${f.severity}, ${f.state})`, { bold: true, size: 10, gap: 2 });
    w.para(f.clauseRef, { size: 8.5, color: MUTED, indent: 8, gap: 2 });
    w.para(f.detail, { size: 9, indent: 8, gap: 2 });
    if (f.magnitude) w.para(`Size of the gap: ${num(f.magnitude.value)} ${f.magnitude.unit}.`, { size: 9, indent: 8, gap: 2 });
    if (f.requiredResponse) w.para(`Asked of the plant: ${f.requiredResponse}`, { size: 9, indent: 8, gap: 2 });
    const row = schedule.rows.find((r) => `DESK-${r.ruleId}` === f.ruleId);
    if (row?.decision) w.para(`Decision: ${decisionText(row.decision.state)}. ${row.decision.reason}`, { size: 9, indent: 8, gap: 2 });
    w.y -= 6;
  }

  // ---- Assertion index ----
  w.heading("Index of figures");
  w.para("Every figure the checks above rest on, with where it came from. A figure typed from a PDF, or snipped from a page, was entered by a person; none was produced by a model.", { size: 9, color: MUTED });
  const how = (x: Assertion) =>
    x.kind === "workbook" ? "Read from the workbook by code" : x.kind === "snip" ? "Snipped from the page by an auditor" : x.kind === "typed" ? "Typed by an auditor" : "";
  w.table(
    [
      { title: "Figure", width: 150 },
      { title: "Value", width: 70, align: "right" },
      { title: "Source file (SHA-256)", width: 145 },
      { title: "Where, and how", width: 142 },
    ],
    assertions.map((x) => [
      x.label,
      `${x.value}${x.unit ? ` ${x.unit}` : ""}`,
      `${x.filename ?? "-"}${x.sha256 ? ` (${x.sha256.slice(0, 12)}...)` : ""}`,
      `${[x.location, x.region ? describeRegion(x.region) : null].filter(Boolean).join(", ")}${how(x) ? `. ${how(x)}` : ""}${x.sourceText ? `. Printed: "${x.sourceText}"` : ""}`,
    ])
  );

  // ---- Reading notes ----
  if (input.notes.length > 0) {
    w.heading("Notes from reading the files", 12);
    for (const n of input.notes) w.para(n, { size: 9, indent: 8, gap: 2 });
  }

  // ---- Open items ----
  const unpinned = schedule.rows.filter((r) => !r.clause.specific).length;
  const unverified = schedule.rows.filter((r) => r.clause.specific && !r.clause.verified).length;
  w.heading("Open items", 12);
  w.para("The layout is generic: no scheme or portal submission template has been supplied.", { size: 9, indent: 8, gap: 2 });
  w.para("Bands marked as product defaults on a line are working tolerances, not figures from the procedure.", { size: 9, indent: 8, gap: 2 });
  if (unpinned > 0) w.para(`${unpinned} check(s) are cited to the procedure as a whole, because they have no single clause.`, { size: 9, indent: 8, gap: 2 });
  if (unverified > 0) w.para(`${unverified} clause reference(s) are not yet confirmed.`, { size: 9, indent: 8, gap: 2 });

  // ---- Evidence appendix ----
  const limit = input.maxEvidencePages ?? 60;
  const docs = new Map(input.documents.map((d) => [d.id, d]));
  const loaded = new Map<string, PDFDocument>();
  const notBound: string[] = [];
  let bound = 0;
  const cited = assertions.filter((x) => (x.kind === "typed" || x.kind === "snip") && x.documentId && x.page);
  for (const x of cited) {
    const doc = docs.get(x.documentId!);
    const name = `${x.label}, ${x.filename ?? "file"} p. ${x.page}`;
    if (!doc?.bytes) {
      notBound.push(`${name}: the file was not available`);
      continue;
    }
    if (bound >= limit) {
      notBound.push(`${name}: over the limit of ${limit} pages`);
      continue;
    }
    const isPdf = doc.mimeType === "application/pdf";
    const isImage = doc.mimeType === "image/jpeg" || doc.mimeType === "image/png";
    if (!isPdf && !isImage) {
      notBound.push(`${name}: ${doc.mimeType} cannot be bound in`);
      continue;
    }

    let embedded: { width: number; height: number; draw: (p: PDFPage, o: { x: number; y: number; width: number; height: number }) => void } | null = null;
    try {
      if (isPdf) {
        let src = loaded.get(doc.id);
        if (!src) {
          src = await PDFDocument.load(doc.bytes, { ignoreEncryption: true, updateMetadata: false });
          loaded.set(doc.id, src);
        }
        if (x.page! > src.getPageCount()) {
          notBound.push(`${name}: the file has ${src.getPageCount()} page(s)`);
          continue;
        }
        const [page] = await pdf.embedPdf(src, [x.page! - 1]);
        embedded = { width: page!.width, height: page!.height, draw: (p, o) => p.drawPage(page!, o) };
      } else {
        const img = doc.mimeType === "image/png" ? await pdf.embedPng(doc.bytes) : await pdf.embedJpg(doc.bytes);
        embedded = { width: img.width, height: img.height, draw: (p, o) => p.drawImage(img, o) };
      }
    } catch (e) {
      notBound.push(`${name}: could not be read (${e instanceof Error ? e.message : "unknown error"})`);
      continue;
    }

    w.newPage();
    w.heading(`Evidence: ${x.label}`, 12);
    w.para(`${x.value}${x.unit ? ` ${x.unit}` : ""} · ${x.filename ?? ""} · page ${x.page}${x.sha256 ? ` · SHA-256 ${x.sha256.slice(0, 16)}...` : ""}`, { size: 9, color: MUTED, gap: 2 });
    w.para(`${how(x)}${x.enteredAt ? `, ${x.enteredAt}` : ""}.${x.sourceText ? ` Printed in the box: "${x.sourceText}"` : ""}${x.region ? ` Box: ${describeRegion(x.region)}.` : ""}`, { size: 9, gap: 8 });
    const areaH = w.y - (M + 28);
    const areaW = W - 2 * M;
    const scale = Math.min(areaW / embedded.width, areaH / embedded.height);
    const dw = embedded.width * scale;
    const dh = embedded.height * scale;
    const px = M + (areaW - dw) / 2;
    const py = w.y - dh;
    embedded.draw(w.page, { x: px, y: py, width: dw, height: dh });
    w.page.drawRectangle({ x: px, y: py, width: dw, height: dh, borderColor: MUTED, borderWidth: 0.5 });
    if (x.region) {
      w.page.drawRectangle({
        x: px + x.region.x * dw,
        y: py + dh - (x.region.y + x.region.height) * dh,
        width: x.region.width * dw,
        height: x.region.height * dh,
        borderColor: AMBER,
        borderWidth: 1.5,
        color: AMBER,
        opacity: 0.12,
        borderOpacity: 1,
      });
    }
    bound += 1;
  }
  if (notBound.length > 0) {
    w.newPage();
    w.heading("Cited pages not bound in", 12);
    for (const n of notBound) w.para(n, { size: 9, indent: 8, gap: 2 });
  }

  // ---- Footers, once the page count is known ----
  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    p.drawText(`VerifyStack desk review binder · ${input.engagement.clientName} · digest ${contentDigest.slice(0, 16)} · page ${i + 1} of ${pages.length}`, {
      x: M,
      y: 22,
      size: 7.5,
      font,
      color: MUTED,
    });
  });

  const bytes = await pdf.save({ useObjectStreams: false });
  return { bytes, contentDigest, pages: pages.length, evidencePages: bound, notBound };
}

/** The SHA-256 of a finished binder, as recorded in the audit log. */
export function binderSha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
