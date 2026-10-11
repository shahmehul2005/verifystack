/**
 * Evidence file rules shared by upload and download. Mirrors the `evidence`
 * bucket settings in migration 0001 so the API refuses what Storage would.
 */

import { openZip } from "../domain/archive/zip";

export const EVIDENCE_MIME_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;

export type EvidenceMimeType = (typeof EVIDENCE_MIME_TYPES)[number];

export const MAX_EVIDENCE_BYTES = 50 * 1024 * 1024;

const MAX_FILENAME_LENGTH = 200;

export function isEvidenceMimeType(value: string | null | undefined): value is EvidenceMimeType {
  return (EVIDENCE_MIME_TYPES as readonly string[]).includes(value ?? "");
}

function startsWith(buf: Uint8Array, bytes: number[], offset = 0): boolean {
  if (buf.length < offset + bytes.length) return false;
  return bytes.every((b, i) => buf[offset + i] === b);
}

/**
 * Type from the file's leading bytes. The declared Content-Type is supplied by
 * the client and is not trusted: a file served back inline with a type the
 * client chose is a stored cross-site scripting path.
 */
export function sniffEvidenceType(buf: Uint8Array): EvidenceMimeType | null {
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(buf, [0x52, 0x49, 0x46, 0x46]) && startsWith(buf, [0x57, 0x45, 0x42, 0x50], 8)) {
    return "image/webp";
  }
  // The PDF header may follow up to 1 KB of leading bytes.
  const head = buf.subarray(0, Math.min(buf.length, 1024));
  const marker = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
  for (let i = 0; i + marker.length <= head.length; i += 1) {
    if (startsWith(head, marker, i)) return "application/pdf";
  }
  return null;
}

export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export const CSV_MIME = "text/csv";
export const ZIP_MIME = "application/zip";

/**
 * What an uploaded file is for.
 *   page         a PDF or image read page by page (extraction route)
 *   spreadsheet  an XLSX workbook (cell mapping)
 *   csv          a delimited text file (time series or table)
 *   archive      an evidence pack ZIP (importer)
 * Only `page` files are ever rendered inline; the rest download as attachments.
 */
export type UploadKind = "page" | "spreadsheet" | "csv" | "archive";

export interface SniffedUpload {
  mime: string;
  kind: UploadKind;
}

export const UPLOAD_MIME_TYPES: readonly string[] = [
  ...EVIDENCE_MIME_TYPES,
  XLSX_MIME,
  CSV_MIME,
  ZIP_MIME,
];

function looksLikeCsv(buf: Uint8Array, filename: string): boolean {
  if (!/\.csv$/i.test(filename)) return false;
  const head = buf.subarray(0, Math.min(buf.length, 4096));
  if (head.includes(0)) return false;
  const text = new TextDecoder("utf-8", { fatal: false }).decode(head);
  const replacement = (text.match(/\uFFFD/g) ?? []).length;
  if (replacement > text.length * 0.02) return false;
  const first = text.replace(/^\uFEFF/, "").trimStart()[0];
  // Markup is never a data file, whatever its extension says.
  if (first === "<") return false;
  return /[,;\t|]/.test(text) && /\n/.test(text);
}

/**
 * Type from leading bytes (and, for CSV only, the file name: plain text has no
 * signature). An XLSX and an evidence pack are both ZIPs and are told apart by
 * their entries. The client's Content-Type is never consulted.
 */
export function sniffUploadType(buf: Uint8Array, filename = ""): SniffedUpload | null {
  const page = sniffEvidenceType(buf);
  if (page) return { mime: page, kind: "page" };
  if (startsWith(buf, [0x50, 0x4b, 0x03, 0x04])) {
    try {
      const zip = openZip(buf);
      if (zip.has("xl/workbook.xml")) return { mime: XLSX_MIME, kind: "spreadsheet" };
      if (zip.has("manifest.json")) return { mime: ZIP_MIME, kind: "archive" };
    } catch {
      return null;
    }
    return null;
  }
  if (looksLikeCsv(buf, filename)) return { mime: CSV_MIME, kind: "csv" };
  return null;
}

/** Display name safe to store and echo: no path, no control characters, bounded length. */
export function sanitizeFilename(raw: string | null | undefined): string {
  let name = Array.from((raw ?? "").replace(/^.*[\\/]/, ""))
    .filter((ch) => {
      const code = ch.charCodeAt(0);
      return code >= 0x20 && code !== 0x7f && ch !== '"';
    })
    .join("")
    .trim();
  if (name.length > MAX_FILENAME_LENGTH) {
    const dot = name.lastIndexOf(".");
    const ext = dot > 0 && name.length - dot <= 10 ? name.slice(dot) : "";
    name = name.slice(0, MAX_FILENAME_LENGTH - ext.length) + ext;
  }
  return name || "upload";
}

/** RFC 6266 Content-Disposition with an ASCII fallback and a UTF-8 filename*. */
export function contentDisposition(kind: "inline" | "attachment", filename: string): string {
  const safe = sanitizeFilename(filename);
  const ascii = safe.replace(/[^\x20-\x7e]/g, "_").replace(/[\\;]/g, "_");
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}
