/**
 * Text-layer reader for evidence PDFs.
 *
 * Deterministic and server-side: it reads the text the PDF actually carries, page by
 * page, and rebuilds visual lines from glyph positions. It never OCRs and never guesses.
 * A scanned page with no text layer returns zero lines and the caller must treat that
 * as "nothing to propose", not as a failure to paper over.
 *
 * pdfjs-dist is loaded lazily from its legacy build, which runs in plain Node without a
 * canvas. Next keeps it external (`serverExternalPackages`), so it is resolved at run time.
 */

export interface PdfPageText {
  /** 1-based page number. */
  page: number;
  /** Visual lines, top to bottom, cells joined by single spaces. */
  lines: string[];
}

interface RawItem {
  str: string;
  x: number;
  y: number;
  width: number;
}

/** Items whose baselines differ by less than this belong to one visual line. */
const LINE_TOLERANCE = 2.5;

/** Rebuild visual lines from positioned text items. Exported for tests. */
export function itemsToLines(items: RawItem[]): string[] {
  const rows: { y: number; items: RawItem[] }[] = [];
  for (const item of items) {
    if (item.str.trim() === "") continue;
    const row = rows.find((r) => Math.abs(r.y - item.y) <= LINE_TOLERANCE);
    if (row) row.items.push(item);
    else rows.push({ y: item.y, items: [item] });
  }
  rows.sort((a, b) => b.y - a.y);
  return rows
    .map((row) =>
      row.items
        .sort((a, b) => a.x - b.x)
        .map((i) => i.str.trim())
        .join(" ")
        .replace(/\s+/g, " ")
        .trim()
    )
    .filter((line) => line.length > 0);
}

export async function readPdfText(bytes: Uint8Array): Promise<PdfPageText[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // pdfjs transfers the buffer, so hand it a copy and leave the caller's bytes intact.
  const data = new Uint8Array(bytes);
  const doc = await pdfjs.getDocument({
    data,
    isEvalSupported: false,
    useSystemFonts: false,
    verbosity: 0,
  }).promise;
  try {
    const pages: PdfPageText[] = [];
    for (let n = 1; n <= doc.numPages; n += 1) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      const items: RawItem[] = [];
      for (const it of content.items) {
        if (!("str" in it)) continue;
        items.push({
          str: it.str,
          x: it.transform[4] ?? 0,
          y: it.transform[5] ?? 0,
          width: it.width,
        });
      }
      pages.push({ page: n, lines: itemsToLines(items) });
    }
    return pages;
  } finally {
    await doc.destroy();
  }
}
