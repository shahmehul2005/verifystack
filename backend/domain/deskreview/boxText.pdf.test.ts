import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts, degrees } from "pdf-lib";
import { pdfItemToPageItem, readBox, type PageTextItem } from "./boxText";

/** A real PDF with text at known places, read back through pdf.js the way the browser does. */
async function pageItems(rotate: number): Promise<PageTextItem[]> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([600, 800]);
  page.drawText("Header line", { x: 50, y: 760, size: 14, font });
  page.drawText("Quantity dispatched", { x: 100, y: 600, size: 12, font });
  page.drawText("18,247 MT", { x: 260, y: 600, size: 12, font });
  page.drawText("Other 999", { x: 100, y: 300, size: 12, font });
  if (rotate) page.setRotation(degrees(rotate));

  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await doc.save()), useSystemFonts: true }).promise;
  const pdfPage = await pdf.getPage(1);
  const viewport = pdfPage.getViewport({ scale: 1 });
  const content = await pdfPage.getTextContent();
  const items: PageTextItem[] = [];
  for (const raw of content.items) {
    if (!("str" in raw) || raw.str.trim() === "") continue;
    const placed = pdfItemToPageItem(raw.str, raw.transform, raw.width, viewport.transform, viewport.width, viewport.height);
    if (placed) items.push(placed);
  }
  await pdf.destroy();
  return items;
}

describe("reading a box from a real PDF", () => {
  it("reads the text and the figure inside a box drawn where the line appears on the page", async () => {
    const items = await pageItems(0);
    // On screen the line sits 200 pt from the top of a 600 x 800 page.
    const read = readBox(items, { x: 90 / 600, y: 185 / 800, width: 270 / 600, height: 30 / 800 });
    expect(read.text).toBe("Quantity dispatched 18,247 MT");
    expect(read.numbers.map((n) => n.value)).toEqual([18247]);
  });

  it("reads nothing from a box over empty space", async () => {
    const items = await pageItems(0);
    expect(readBox(items, { x: 0.8, y: 0.8, width: 0.15, height: 0.1 }).text).toBe("");
  });

  it("keeps every item on the page and finds the figure on a rotated page", async () => {
    const items = await pageItems(90);
    expect(items).toHaveLength(4);
    expect(items.every((i) => i.x >= -0.01 && i.y >= -0.01 && i.x + i.width <= 1.01 && i.y + i.height <= 1.01)).toBe(true);
    const target = items.find((i) => i.text.includes("18,247"))!;
    const read = readBox(items, { x: target.x - 0.01, y: target.y - 0.01, width: target.width + 0.02, height: target.height + 0.02 });
    expect(read.numbers.map((n) => n.value)).toEqual([18247]);
  });
});
