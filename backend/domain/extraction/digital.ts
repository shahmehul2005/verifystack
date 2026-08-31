/**
 * Process 3.2 — deterministic layout parse for clean digital PDFs.
 * Uses pdf.js text items (no Gemini). Vision path stays in gemini.ts.
 */

export interface TextItem {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
  page: number;
}

export interface DigitalParseResult {
  route: "digital" | "vision";
  pageCount: number;
  textChars: number;
  items: TextItem[];
}

const DIGITAL_CHAR_THRESHOLD = 200;

export function chooseRoute(textChars: number, mimeType: string): "digital" | "vision" {
  if (mimeType !== "application/pdf") return "vision";
  return textChars >= DIGITAL_CHAR_THRESHOLD ? "digital" : "vision";
}

export function normaliseItem(
  item: { str: string; transform: number[]; width: number; height: number },
  page: { width: number; height: number },
  pageNumber: number
): TextItem {
  const x = item.transform[4] ?? 0;
  const y = item.transform[5] ?? 0;
  return {
    str: item.str,
    x: x / page.width,
    y: 1 - (y + item.height) / page.height,
    width: item.width / page.width,
    height: item.height / page.height,
    page: pageNumber,
  };
}

export { DIGITAL_CHAR_THRESHOLD };
