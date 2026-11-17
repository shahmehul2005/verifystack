import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DownloadLink, WorkbookGridView, WorkbookViewer } from "./workbook-viewer";
import { pickDefaultPreviewDoc, previewModeFor, type SheetView } from "@verifystack/backend/domain/intake/preview";
import { CSV_MIME, XLSX_MIME } from "@verifystack/backend/lib/evidence";

function view(overrides: Partial<SheetView["active"]> = {}): SheetView {
  return {
    sheets: [
      { name: "Form-Sb", rowCount: 2, colCount: 2 },
      { name: "Notes", rowCount: 1, colCount: 1 },
    ],
    active: {
      index: 0,
      name: "Form-Sb",
      columns: ["A", "B"],
      rowStart: 1,
      rows: [
        { n: 1, cells: [{ value: "Clinker" }, { value: 12.5 }] },
        { n: 2, cells: [{ value: "Total" }, { value: 25, formula: "SUM(B1:B1)" }] },
      ],
      hasMoreRows: false,
      hasMoreColumns: false,
      sourceTruncated: false,
      ...overrides,
    },
  };
}

const grid = (v: SheetView, truncated = false) =>
  renderToStaticMarkup(
    createElement(WorkbookGridView, { view: v, truncated, onSheetChange: () => {}, onRowStartChange: () => {} })
  );

describe("WorkbookGridView", () => {
  it("shows sheet tabs, column letters and row numbers", () => {
    const html = grid(view());
    expect(html).toContain('role="tablist"');
    expect(html).toContain("Form-Sb");
    expect(html).toContain("Notes");
    expect(html).toMatch(/<th[^>]*>A<\/th>/);
    expect(html).toMatch(/<th[^>]*>B<\/th>/);
    expect(html).toMatch(/<th[^>]*>2<\/th>/);
  });

  it("marks formula cells and keeps raw values", () => {
    const html = grid(view());
    expect(html).toContain('aria-label="formula"');
    expect(html).toContain("12.5");
  });

  it("is read-only", () => {
    const html = grid(view());
    expect(html).not.toMatch(/<input/i);
    expect(html).not.toMatch(/<textarea/i);
    expect(html).not.toMatch(/contenteditable/i);
  });

  it("enables Next rows only when hasMoreRows", () => {
    const next = (html: string) => html.match(/<button[^>]*>Next rows<\/button>/)![0];
    expect(next(grid(view({ hasMoreRows: true })))).not.toMatch(/ disabled=""/);
    expect(next(grid(view({ hasMoreRows: false })))).toMatch(/ disabled=""/);
  });

  it("enables Previous rows only after the first window", () => {
    const prev = (html: string) => html.match(/<button[^>]*>Previous rows<\/button>/)![0];
    expect(prev(grid(view({ rowStart: 3 })))).not.toMatch(/ disabled=""/);
    expect(prev(grid(view()))).toMatch(/ disabled=""/);
  });
});

describe("Download control", () => {
  it("is a link to the file route with ?download=1", () => {
    const html = renderToStaticMarkup(createElement(DownloadLink, { documentId: "doc-1" }));
    expect(html).toContain('href="/api/documents/doc-1/file?download=1"');
    expect(html).toContain("Download");
  });
});

describe("spreadsheet preview", () => {
  it("never mounts an iframe for an XLSX document", () => {
    expect(previewModeFor(XLSX_MIME)).toBe("sheet");
    expect(previewModeFor(CSV_MIME)).toBe("sheet");
    const html = renderToStaticMarkup(createElement(WorkbookViewer, { documentId: "doc-1" }));
    expect(html).not.toMatch(/<iframe/i);
    expect(html).not.toContain("/file");
  });

  it("uses an inline frame only for evidence types, and none for others", () => {
    expect(previewModeFor("application/pdf")).toBe("embed");
    expect(previewModeFor("application/zip")).toBe("none");
  });

  it("selects the pro forma slot first, else the first document, else empty", () => {
    expect(
      pickDefaultPreviewDoc([
        { id: "a", slot: "coal_certificate" },
        { id: "b", slot: "proforma_workbook" },
      ])
    ).toBe("b");
    expect(pickDefaultPreviewDoc([{ id: "a" }, { id: "c" }])).toBe("a");
    expect(pickDefaultPreviewDoc([])).toBe("");
  });
});
