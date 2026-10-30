import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { itemsToLines, readPdfText } from "./pdfText";

describe("itemsToLines", () => {
  it("joins cells on one baseline left to right and orders lines top to bottom", () => {
    const lines = itemsToLines([
      { str: "12,500.0", x: 300, y: 700, width: 40 },
      { str: "Clinker Production", x: 50, y: 700.4, width: 120 },
      { str: "Clinker Opening Stock", x: 50, y: 680, width: 120 },
      { str: "2,500.0", x: 300, y: 680, width: 40 },
      { str: "   ", x: 10, y: 600, width: 1 },
    ]);
    expect(lines).toEqual(["Clinker Production 12,500.0", "Clinker Opening Stock 2,500.0"]);
  });
});

describe("readPdfText", () => {
  it("reads the text layer of a real PDF page by page, and leaves the caller's bytes intact", async () => {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const p1 = pdf.addPage([400, 300]);
    p1.drawText("Clinker Production", { x: 40, y: 250, size: 11, font });
    p1.drawText("12,500.0", { x: 220, y: 250, size: 11, font });
    p1.drawText("Clinker Export", { x: 40, y: 230, size: 11, font });
    p1.drawText("833.3", { x: 220, y: 230, size: 11, font });
    const p2 = pdf.addPage([400, 300]);
    p2.drawText("Second page", { x: 40, y: 250, size: 11, font });
    const bytes = new Uint8Array(await pdf.save());
    const before = bytes.length;

    const pages = await readPdfText(bytes);
    expect(bytes.length).toBe(before);
    expect(pages).toHaveLength(2);
    expect(pages[0]).toEqual({ page: 1, lines: ["Clinker Production 12,500.0", "Clinker Export 833.3"] });
    expect(pages[1]?.lines).toEqual(["Second page"]);
  });

  it("returns an empty line list for a page with no text layer", async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage([200, 200]);
    const pages = await readPdfText(new Uint8Array(await pdf.save()));
    expect(pages).toEqual([{ page: 1, lines: [] }]);
  });
});
