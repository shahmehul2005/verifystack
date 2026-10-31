"use client";

import { useRef, useState } from "react";
import { pdfItemToPageItem, readBox, type NumberCandidate, type PageTextItem } from "@verifystack/backend/domain/deskreview/boxText";
import type { Region } from "@verifystack/backend/domain/deskreview/snip";

/** The text runs of pages already read, so drawing a second box on a page does not load the PDF again. */
const pageCache = new Map<string, PageTextItem[]>();

/** The text on one PDF page as boxes on the page. Empty when the page is a scan with no text layer. */
async function pageText(src: string, page: number): Promise<PageTextItem[]> {
  const key = `${src}#${page}`;
  const cached = pageCache.get(key);
  if (cached) return cached;
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  const pdf = await pdfjs.getDocument({ url: src, withCredentials: true }).promise;
  try {
    const pdfPage = await pdf.getPage(Math.min(Math.max(1, page), pdf.numPages));
    const viewport = pdfPage.getViewport({ scale: 1 });
    const content = await pdfPage.getTextContent();
    const items: PageTextItem[] = [];
    for (const raw of content.items) {
      if (!("str" in raw) || raw.str.trim() === "") continue;
      const placed = pdfItemToPageItem(raw.str, raw.transform, raw.width, viewport.transform, viewport.width, viewport.height);
      if (placed) items.push(placed);
    }
    pageCache.set(key, items);
    return items;
  } finally {
    void pdf.destroy();
  }
}

/**
 * Reads what is printed inside a box drawn on a page, so the person confirms a
 * figure instead of retyping it. It reads the PDF's own text, with code. A scan
 * or an image has none, and then the form is left for the person to fill.
 *
 * `onText` and `onValue` are given what was read; the person still checks both.
 */
export function useBoxReader({
  src,
  mimeType,
  page,
  onText,
  onValue,
}: {
  src: string;
  mimeType: string | null | undefined;
  page: number;
  onText: (text: string) => void;
  onValue: (value: string) => void;
}) {
  const [reading, setReading] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<NumberCandidate[]>([]);
  const latest = useRef(0);

  function clear() {
    latest.current += 1;
    setReading(false);
    setNote(null);
    setCandidates([]);
  }

  async function read(region: Region) {
    const mine = ++latest.current;
    setCandidates([]);
    setNote(null);
    if (mimeType && !mimeType.includes("pdf")) {
      setNote("This is an image, so there is no text to read. Type what is printed in the box and the figure.");
      return;
    }
    setReading(true);
    try {
      const items = await pageText(src, page);
      if (mine !== latest.current) return;
      if (items.length === 0) {
        setNote("This page has no readable text (it is a scan). Type what is printed in the box and the figure.");
        return;
      }
      const box = readBox(items, region);
      if (box.text === "") {
        setNote("Nothing readable inside the box. Move or enlarge it, or type the figure.");
        return;
      }
      onText(box.text.slice(0, 300));
      if (box.numbers.length === 1) {
        onValue(String(box.numbers[0]!.value));
        setNote("Read from the page: one figure in the box. Check it against the page.");
      } else if (box.numbers.length > 1) {
        onValue("");
        setCandidates(box.numbers);
        setNote("Several figures in the box. Pick the one you mean, or draw a tighter box.");
      } else {
        onValue("");
        setNote("The box holds text but no figure. Type the figure, or draw the box around it.");
      }
    } catch {
      if (mine !== latest.current) return;
      setNote("Could not read the page text. Type what is printed in the box and the figure.");
    } finally {
      if (mine === latest.current) setReading(false);
    }
  }

  return { reading, note, candidates, read, clear };
}
