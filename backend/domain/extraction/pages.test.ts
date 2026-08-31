import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import {
  MAX_EXTRACT_PAGES,
  PageSplitError,
  countEvidencePages,
  documentPageInserts,
  mapLimit,
  splitEvidencePages,
} from "./pages";

async function twoPagePdf(): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const a = pdf.addPage([200, 200]);
  a.drawText("page one coal 18247 MT", { x: 20, y: 100, size: 12, font });
  const b = pdf.addPage([200, 200]);
  b.drawText("page two production 1850000 t", { x: 20, y: 100, size: 12, font });
  return Buffer.from(await pdf.save());
}

describe("splitEvidencePages", () => {
  it("treats a PNG as a single page", async () => {
    const pages = await splitEvidencePages(Buffer.from("not-really-png"), "image/png");
    expect(pages).toHaveLength(1);
    expect(pages[0]?.pageNumber).toBe(1);
    expect(pages[0]?.mimeType).toBe("image/png");
  });

  it("splits a PDF into one one-page PDF per sheet", async () => {
    const buf = await twoPagePdf();
    expect(await countEvidencePages(buf, "application/pdf")).toBe(2);
    const pages = await splitEvidencePages(buf, "application/pdf");
    expect(pages.map((p) => p.pageNumber)).toEqual([1, 2]);
    expect(pages.every((p) => p.mimeType === "application/pdf")).toBe(true);
    for (const p of pages) {
      const again = await PDFDocument.load(p.bytes);
      expect(again.getPageCount()).toBe(1);
    }
  });

  it("refuses a packet over the extract cap", async () => {
    const pdf = await PDFDocument.create();
    for (let i = 0; i < MAX_EXTRACT_PAGES + 1; i++) pdf.addPage();
    const buf = Buffer.from(await pdf.save());
    await expect(splitEvidencePages(buf, "application/pdf")).rejects.toThrow(PageSplitError);
  });
});

describe("documentPageInserts", () => {
  it("writes one row per page against the original storage object", () => {
    const rows = documentPageInserts("org", "doc", 3, "evidence/abc.pdf");
    expect(rows.map((r) => r.page_number)).toEqual([1, 2, 3]);
    expect(rows.every((r) => r.storage_path === "evidence/abc.pdf")).toBe(true);
  });
});

describe("mapLimit", () => {
  it("preserves order with a concurrency cap", async () => {
    const seen: number[] = [];
    const out = await mapLimit([1, 2, 3, 4], 2, async (n) => {
      seen.push(n);
      return n * 10;
    });
    expect(out).toEqual([10, 20, 30, 40]);
    expect(seen.sort()).toEqual([1, 2, 3, 4]);
  });
});
