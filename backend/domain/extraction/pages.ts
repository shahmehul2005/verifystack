/**
 * Process 2.0 page split — one evidence file becomes N addressable pages.
 *
 * Images are one page. PDFs are split into single-page PDFs in memory (pdf-lib,
 * no canvas). Gemini then sees page N as its own document; we stamp the original
 * page number onto provenance so the workbench can highlight the right sheet.
 */

import { PDFDocument } from "pdf-lib";

export const MAX_EXTRACT_PAGES = 40;

export class PageSplitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PageSplitError";
  }
}

export interface SplitPage {
  pageNumber: number;
  mimeType: "image/png" | "image/jpeg" | "application/pdf";
  bytes: Uint8Array;
}

function imageMime(
  mimeType: string
): "image/png" | "image/jpeg" | null {
  if (mimeType === "image/png") return "image/png";
  if (mimeType === "image/jpeg" || mimeType === "image/jpg") return "image/jpeg";
  return null;
}

export async function countEvidencePages(buf: Buffer, mimeType: string): Promise<number> {
  if (imageMime(mimeType) || mimeType === "image/webp") return 1;
  if (mimeType !== "application/pdf") return 1;
  try {
    const pdf = await PDFDocument.load(buf, { ignoreEncryption: true });
    return Math.max(1, pdf.getPageCount());
  } catch {
    return 1;
  }
}

export async function splitEvidencePages(
  buf: Buffer,
  mimeType: string
): Promise<SplitPage[]> {
  const image = imageMime(mimeType);
  if (image) {
    return [{ pageNumber: 1, mimeType: image, bytes: new Uint8Array(buf) }];
  }
  if (mimeType !== "application/pdf") {
    throw new PageSplitError(`Cannot split ${mimeType}. Use PDF, PNG, or JPEG.`);
  }

  let pdf: PDFDocument;
  try {
    pdf = await PDFDocument.load(buf, { ignoreEncryption: true });
  } catch {
    throw new PageSplitError("This PDF could not be opened. It may be damaged or password-protected.");
  }

  const n = pdf.getPageCount();
  if (n < 1) {
    throw new PageSplitError("This PDF has no pages.");
  }
  if (n > MAX_EXTRACT_PAGES) {
    throw new PageSplitError(
      `This PDF has ${n} pages. Extract is capped at ${MAX_EXTRACT_PAGES} pages so a scan packet cannot stall the run. Split the file and upload in parts.`
    );
  }

  const pages: SplitPage[] = [];
  for (let i = 0; i < n; i++) {
    const one = await PDFDocument.create();
    const [copied] = await one.copyPages(pdf, [i]);
    one.addPage(copied);
    pages.push({
      pageNumber: i + 1,
      mimeType: "application/pdf",
      bytes: await one.save(),
    });
  }
  return pages;
}

/** Run `fn` over items with at most `limit` in flight. */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, limit), items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!, i);
    }
  });
  await Promise.all(workers);
  return out;
}

export function documentPageInserts(
  organizationId: string,
  documentId: string,
  pageCount: number,
  storagePath: string
) {
  const n = Math.max(1, pageCount);
  return Array.from({ length: n }, (_, i) => ({
    organization_id: organizationId,
    document_id: documentId,
    page_number: i + 1,
    storage_path: storagePath,
  }));
}
