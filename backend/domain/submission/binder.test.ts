import { writeFileSync } from "node:fs";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";
import type { DeskOutcome } from "../deskreview/engine";
import { buildLeadSchedule } from "../deskreview/leadSchedule";
import { binderSha256, buildBinder, collectAssertions, contentDigestOf, stableStringify, type BinderInput } from "./binder";

/** A two-page PDF standing in for a stored evidence file. */
async function evidencePdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create({ updateMetadata: false });
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (const n of [1, 2]) {
    const page = pdf.addPage([595, 842]);
    page.drawText(`Monthly production report, page ${n}`, { x: 60, y: 780, size: 16, font });
    page.drawText("Clinker Production: 12,500 t", { x: 60, y: 600, size: 14, font });
  }
  return pdf.save({ useObjectStreams: false });
}

const outcomes: DeskOutcome[] = [
  {
    id: "coverage_clinker",
    section: "Annual figures",
    label: "Clinker coverage",
    status: "fail",
    detail: "Annual cell 1,50,000 is backed by 1 of 12 month(s) of evidence.",
    thresholdSource: "DEFAULT_TOLERANCE (product comparison tolerance)",
    sources: [
      { key: "pf.clinker_t", label: "Clinker produced (annual cell)", value: 150000, unit: "t", slot: "proforma_workbook", documentId: "d-pf", filename: "15_proforma.xlsx", location: "1_Production!B6", kind: "workbook" },
      { key: "scada.clinker_sum", label: "SCADA clinker total", value: 12500, unit: "t", slot: "production_evidence", documentId: "d-scada", filename: "01_scada.xlsx", location: "Daily", kind: "workbook" },
    ],
  },
  {
    id: "scada_clinker_vs_mpr",
    section: "Production",
    label: "Clinker: SCADA against monthly report",
    status: "fail",
    detail: "Parts sum to 12,500; target is 12,300; difference 200.",
    actual: 12500,
    expected: 12300,
    diff: 200,
    sources: [
      {
        key: "mpr.clinker_t",
        label: "Monthly report: clinker produced",
        value: 12300,
        unit: "t",
        slot: "production_evidence",
        documentId: "d-mpr",
        filename: "03_monthly_production_report.pdf",
        location: "p. 1",
        kind: "snip",
        enteredAt: "2026-10-30T09:00:00.000Z",
        region: { x: 0.1, y: 0.2, width: 0.3, height: 0.05 },
        sourceText: "Clinker Production: 12,300 t",
      },
    ],
  },
  {
    id: "form1_direct",
    section: "Form 1",
    label: "Form 1 direct Δ emissions in tCO₂e",
    status: "pass",
    detail: "Agrees.",
    actual: 100,
    expected: 100,
    diff: 0,
    sources: [{ key: "form1.direct_co2_t", label: "Form 1 direct", value: 100, unit: "tCO2e", documentId: "d-mpr", filename: "03_monthly_production_report.pdf", location: "p. 2", kind: "typed", enteredAt: "2026-10-30T09:05:00.000Z" }],
  },
];

async function input(over: Partial<BinderInput> = {}): Promise<BinderInput> {
  const bytes = await evidencePdf();
  return {
    generatedAt: "2026-10-30T10:00:00.000Z",
    engagement: { id: "eng-1", clientName: "Rajkot Cement Works", plantName: "Unit 1", packId: "CCTS-CEMENT-v1", packVersion: "1.0.0", complianceYear: "FY2025-26" },
    run: { id: "run-1", at: "2026-10-30T09:30:00.000Z" },
    schedule: buildLeadSchedule({
      outcomes,
      materiality: { reportedTotal: 50000, fraction: 0.02, threshold: 1000, quantified: 1200, limitations: ["Calcination CO2 is missing."] },
      resolutions: { scada_clinker_vs_mpr: { state: "accepted_with_explanation", reason: "The plant corrected the report." } },
    }),
    findings: [
      {
        ruleId: "DESK-scada_clinker_vs_mpr",
        title: "Clinker: SCADA against monthly report",
        severity: "warn",
        state: "closed",
        clauseRef: "BEE CCTS Detailed Procedure (v1.0, July 2024) - consistency (no single clause; cited to the procedure as a whole)",
        detail: "Parts sum to 12,500; target is 12,300; difference 200.",
        requiredResponse: "Explain the difference.",
        magnitude: { value: 200, unit: "t" },
      },
    ],
    documents: [
      { id: "d-pf", filename: "15_proforma.xlsx", sha256: "a".repeat(64), mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
      { id: "d-scada", filename: "01_scada.xlsx", sha256: "b".repeat(64), mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
      { id: "d-mpr", filename: "03_monthly_production_report.pdf", sha256: "c".repeat(64), mimeType: "application/pdf", bytes },
    ],
    signoffs: [{ role: "verifier", attestorName: "A. Rao", statement: "I attest.", at: "2026-10-30T09:45:00.000Z", reportHash: "d".repeat(64) }],
    notes: ["01_scada.xlsx - Daily: 2 dated row(s) have nothing under \"Clinker Production (t)\"."],
    ...over,
  };
}

describe("stableStringify", () => {
  it("writes the same text whatever order the keys were added in", () => {
    expect(stableStringify({ b: 1, a: { d: [1, { y: 1, x: 2 }], c: null } })).toBe(stableStringify({ a: { c: null, d: [1, { x: 2, y: 1 }] }, b: 1 }));
    expect(stableStringify({ a: undefined, b: 1 })).toBe('{"b":1}');
  });
});

describe("collectAssertions", () => {
  it("lists each figure once, with its file hash, page and region, in a fixed order", async () => {
    const i = await input();
    const a = collectAssertions(i.schedule, i.documents);
    expect(a.map((x) => x.key)).toEqual(["form1.direct_co2_t", "mpr.clinker_t", "pf.clinker_t", "scada.clinker_sum"]);
    const snip = a.find((x) => x.key === "mpr.clinker_t")!;
    expect(snip).toMatchObject({ kind: "snip", page: 1, sha256: "c".repeat(64), sourceText: "Clinker Production: 12,300 t", region: { x: 0.1, y: 0.2, width: 0.3, height: 0.05 } });
    expect(a.find((x) => x.key === "pf.clinker_t")).toMatchObject({ kind: "workbook", page: null, location: "1_Production!B6" });
  });
});

describe("buildBinder", () => {
  it("makes the same bytes from the same inputs, so a reviewer can rebuild and compare", async () => {
    const first = await buildBinder(await input());
    const second = await buildBinder(await input());
    expect(binderSha256(second.bytes)).toBe(binderSha256(first.bytes));
    expect(second.contentDigest).toBe(first.contentDigest);
  });

  it("is a readable PDF with the cited pages bound in, and puts its digest on every page", async () => {
    const result = await buildBinder(await input());
    const pdf = await PDFDocument.load(result.bytes);
    expect(pdf.getPageCount()).toBe(result.pages);
    expect(result.evidencePages).toBe(2);
    expect(result.notBound).toEqual([]);
    expect(pdf.getTitle()).toBe("Desk review binder, Rajkot Cement Works");
    expect(pdf.getKeywords()).toContain(result.contentDigest);
    expect(result.contentDigest).toMatch(/^[0-9a-f]{64}$/);
    if (process.env.BINDER_SAMPLE_OUT) writeFileSync(process.env.BINDER_SAMPLE_OUT, result.bytes);
  });

  it("changes the digest when a figure, a decision or a source changes", async () => {
    const base = await input();
    const a = collectAssertions(base.schedule, base.documents);
    const digest = contentDigestOf(base, a);
    expect(contentDigestOf(base, a)).toBe(digest);

    const moved = { ...base, documents: base.documents.map((d) => (d.id === "d-mpr" ? { ...d, sha256: "e".repeat(64) } : d)) };
    expect(contentDigestOf(moved, collectAssertions(moved.schedule, moved.documents))).not.toBe(digest);

    const undecided = { ...base, schedule: buildLeadSchedule({ outcomes }) };
    expect(contentDigestOf(undecided, collectAssertions(undecided.schedule, undecided.documents))).not.toBe(digest);
  });

  it("says so, and carries on, when a cited page cannot be bound in", async () => {
    const base = await input();
    const noBytes = await buildBinder({ ...base, documents: base.documents.map((d) => ({ ...d, bytes: null })) });
    expect(noBytes.evidencePages).toBe(0);
    expect(noBytes.notBound.join(" ")).toMatch(/file was not available/);

    const short = await buildBinder({
      ...base,
      schedule: buildLeadSchedule({ outcomes: outcomes.map((o) => ({ ...o, sources: o.sources?.map((s) => (s.kind === "snip" ? { ...s, location: "p. 9" } : s)) })) }),
    });
    expect(short.notBound.join(" ")).toMatch(/has 2 page\(s\)/);
    expect((await PDFDocument.load(short.bytes)).getPageCount()).toBe(short.pages);
  });

  it("stops at the evidence page limit and lists what it left out", async () => {
    const limited = await buildBinder({ ...(await input()), maxEvidencePages: 1 });
    expect(limited.evidencePages).toBe(1);
    expect(limited.notBound.join(" ")).toMatch(/over the limit of 1 pages/);
  });

  it("survives characters a standard font cannot draw", async () => {
    const result = await buildBinder(await input());
    expect(result.bytes.byteLength).toBeGreaterThan(1000);
  });
});
