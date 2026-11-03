import { describe, expect, it } from "vitest";
import {
  XLSX_MIME,
  contentDisposition,
  isEvidenceMimeType,
  sanitizeFilename,
  sniffEvidenceType,
  sniffUploadType,
} from "./evidence";
import { writeZip } from "../domain/archive/zip";

const bytes = (...b: number[]) => Uint8Array.from([...b, ...new Array(16).fill(0)]);
const ascii = (s: string) => Uint8Array.from([...s].map((c) => c.charCodeAt(0)));

describe("sniffEvidenceType", () => {
  it("recognises the four evidence types by their leading bytes", () => {
    expect(sniffEvidenceType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe("image/png");
    expect(sniffEvidenceType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
    expect(sniffEvidenceType(ascii("RIFF\0\0\0\0WEBPVP8 "))).toBe("image/webp");
    expect(sniffEvidenceType(ascii("%PDF-1.7\n"))).toBe("application/pdf");
  });

  it("accepts a PDF header after leading junk inside the first kilobyte", () => {
    expect(sniffEvidenceType(ascii(`${" ".repeat(100)}%PDF-1.4`))).toBe("application/pdf");
    expect(sniffEvidenceType(ascii(`${" ".repeat(2000)}%PDF-1.4`))).toBeNull();
  });

  it("refuses HTML and SVG whatever the client claims", () => {
    expect(sniffEvidenceType(ascii("<html><script>alert(1)</script></html>"))).toBeNull();
    expect(sniffEvidenceType(ascii('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
  });
});

describe("sniffUploadType", () => {
  const enc = (s: string) => new TextEncoder().encode(s);
  const zipOf = (...names: string[]) =>
    writeZip(names.map((name) => ({ name, data: enc("x") })));

  it("passes page evidence through unchanged", () => {
    expect(sniffUploadType(ascii("%PDF-1.7\n"), "a.pdf")).toEqual({
      mime: "application/pdf",
      kind: "page",
    });
  });

  it("tells an XLSX workbook from an evidence pack by the entries inside", () => {
    expect(sniffUploadType(zipOf("[Content_Types].xml", "xl/workbook.xml"), "a.xlsx")).toEqual({
      mime: XLSX_MIME,
      kind: "spreadsheet",
    });
    expect(sniffUploadType(zipOf("manifest.json", "a.pdf"), "pack.zip")).toEqual({
      mime: "application/zip",
      kind: "archive",
    });
  });

  it("refuses a ZIP that is neither, and a corrupt one", () => {
    expect(sniffUploadType(zipOf("notes.txt"), "x.zip")).toBeNull();
    expect(sniffUploadType(Uint8Array.from([0x50, 0x4b, 0x03, 0x04, ...new Array(40).fill(1)]), "x.zip")).toBeNull();
  });

  it("accepts CSV text only when the name says so, and never markup", () => {
    const csv = enc("Timestamp,Value\n2025-04-01 00:00,1\n");
    expect(sniffUploadType(csv, "scada.csv")).toEqual({ mime: "text/csv", kind: "csv" });
    expect(sniffUploadType(csv, "scada.txt")).toBeNull();
    expect(sniffUploadType(enc("<html>a,b\nc,d</html>"), "x.csv")).toBeNull();
    expect(sniffUploadType(Uint8Array.from([97, 44, 98, 10, 0, 1, 2]), "x.csv")).toBeNull();
  });
});

describe("evidence filenames", () => {
  it("strips paths, quotes and control characters", () => {
    expect(sanitizeFilename("..\\..\\etc/pass\"wd\r\n.pdf")).toBe("passwd.pdf");
    expect(sanitizeFilename("")).toBe("upload");
    expect(sanitizeFilename(null)).toBe("upload");
  });

  it("caps length but keeps the extension", () => {
    const name = sanitizeFilename(`${"a".repeat(500)}.pdf`);
    expect(name.length).toBe(200);
    expect(name.endsWith(".pdf")).toBe(true);
  });

  it("builds a header-safe Content-Disposition", () => {
    expect(contentDisposition("inline", "bill.pdf")).toBe(
      `inline; filename="bill.pdf"; filename*=UTF-8''bill.pdf`
    );
    const h = contentDisposition("attachment", "बिल;\".pdf");
    expect(h).not.toMatch(/[\r\n]/);
    expect(h.startsWith('attachment; filename="')).toBe(true);
  });

  it("only treats the allowlisted types as renderable", () => {
    expect(isEvidenceMimeType("application/pdf")).toBe(true);
    expect(isEvidenceMimeType("text/html")).toBe(false);
    expect(isEvidenceMimeType(null)).toBe(false);
  });
});
