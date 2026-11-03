import type { Region } from "./snip";

/**
 * Reading the text printed inside a box drawn on a page, from the PDF's own text
 * layer. This is code reading characters that are already in the file, not a
 * model reading an image, so the figure a person confirms is copied from the
 * document and not retyped. A scanned page has no text layer and reads nothing.
 */

/** One run of text on a page, as a box in fractions of the page from its top-left corner. */
export interface PageTextItem {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface NumberCandidate {
  /** As printed, without the surrounding text: "18,247" */
  text: string;
  value: number;
}

export interface BoxRead {
  /** Everything printed inside the box, in reading order. */
  text: string;
  numbers: NumberCandidate[];
}

type Matrix = readonly number[];

/** The same product pdf.js uses to put a text item's matrix into viewport space. */
function multiply(m1: Matrix, m2: Matrix): number[] {
  return [
    m1[0]! * m2[0]! + m1[2]! * m2[1]!,
    m1[1]! * m2[0]! + m1[3]! * m2[1]!,
    m1[0]! * m2[2]! + m1[2]! * m2[3]!,
    m1[1]! * m2[2]! + m1[3]! * m2[3]!,
    m1[0]! * m2[4]! + m1[2]! * m2[5]! + m1[4]!,
    m1[1]! * m2[4]! + m1[3]! * m2[5]! + m1[5]!,
  ];
}

/**
 * A pdf.js text item as a box on the page. `viewportTransform` is the page
 * viewport's matrix, `itemTransform` and `width` come from the text item, and
 * `pageWidth` and `pageHeight` are the viewport's size. Handles a rotated page
 * by taking the box around the item's four corners.
 */
export function pdfItemToPageItem(
  text: string,
  itemTransform: Matrix,
  width: number,
  viewportTransform: Matrix,
  pageWidth: number,
  pageHeight: number
): PageTextItem | null {
  if (pageWidth <= 0 || pageHeight <= 0 || itemTransform.length < 6 || viewportTransform.length < 6) return null;
  const t = multiply(viewportTransform, itemTransform);
  const scale = Math.hypot(viewportTransform[0]!, viewportTransform[1]!) || 1;
  const along = Math.hypot(t[0]!, t[1]!);
  const upLength = Math.hypot(t[2]!, t[3]!);
  const run = width * scale;
  // The direction the text runs, and the direction up the glyphs, both in viewport pixels.
  const dir = along > 0 ? [(t[0]! / along) * run, (t[1]! / along) * run] : [run, 0];
  const up = [t[2]!, t[3]!];
  const origin = [t[4]!, t[5]!];
  const corners = [
    origin,
    [origin[0]! + dir[0]!, origin[1]! + dir[1]!],
    [origin[0]! + up[0]!, origin[1]! + up[1]!],
    [origin[0]! + dir[0]! + up[0]!, origin[1]! + dir[1]! + up[1]!],
  ];
  const xs = corners.map((c) => c[0]!);
  const ys = corners.map((c) => c[1]!);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  if (!Number.isFinite(left) || !Number.isFinite(top) || upLength === 0) return null;
  return {
    text,
    x: left / pageWidth,
    y: top / pageHeight,
    width: (Math.max(...xs) - left) / pageWidth,
    height: (Math.max(...ys) - top) / pageHeight,
  };
}

/** How much of an item lies inside the region, as a share of the item. A zero-size item counts when its point is inside. */
function share(item: PageTextItem, region: Region): number {
  const right = region.x + region.width;
  const bottom = region.y + region.height;
  if (item.width <= 0 || item.height <= 0) {
    return item.x >= region.x && item.x <= right && item.y >= region.y && item.y <= bottom ? 1 : 0;
  }
  const w = Math.min(item.x + item.width, right) - Math.max(item.x, region.x);
  const h = Math.min(item.y + item.height, bottom) - Math.max(item.y, region.y);
  if (w <= 0 || h <= 0) return 0;
  return (w * h) / (item.width * item.height);
}

/** The text inside the region, top line first and left to right within a line. Items mostly inside are taken. */
export function textInRegion(items: readonly PageTextItem[], region: Region): string {
  const inside = items.filter((i) => i.text.trim() !== "" && share(i, region) >= 0.5);
  const sorted = [...inside].sort((a, b) => a.y + a.height / 2 - (b.y + b.height / 2));
  const lines: PageTextItem[][] = [];
  for (const item of sorted) {
    const centre = item.y + item.height / 2;
    const line = lines.find((l) => {
      const first = l[0]!;
      return Math.abs(first.y + first.height / 2 - centre) <= Math.max(first.height, item.height) / 2;
    });
    if (line) line.push(item);
    else lines.push([item]);
  }
  return lines
    .map((l) => l.sort((a, b) => a.x - b.x).map((i) => i.text.trim()).join(" "))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Digits with western (1,234,567) or Indian (12,34,567) grouping, and an optional decimal part. */
const GROUPED = /^-?\d{1,3}(,\d{2,3})+(\.\d+)?$/;
const PLAIN = /^-?\d+(\.\d+)?$/;

/**
 * The numbers printed in some text. A digit string stuck to a letter ("A12") is not a figure. A
 * comma that is not a thousands separator is dropped, not guessed at. The same figure printed twice
 * is listed once.
 */
export function numbersIn(text: string): NumberCandidate[] {
  const found: NumberCandidate[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(/(^|[^\w.,])(-?\d[\d,]*(?:\.\d+)?)/g)) {
    const raw = match[2]!.replace(/,+$/, "");
    if (!(PLAIN.test(raw) || GROUPED.test(raw))) continue;
    const value = Number(raw.replace(/,/g, ""));
    if (!Number.isFinite(value) || seen.has(String(value))) continue;
    seen.add(String(value));
    found.push({ text: raw, value });
  }
  return found;
}

export function readBox(items: readonly PageTextItem[], region: Region): BoxRead {
  const text = textInRegion(items, region);
  return { text, numbers: numbersIn(text) };
}
