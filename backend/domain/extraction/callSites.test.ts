import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Scan test: extraction call sites must use the Extractor_Service, not Gemini.
 * Validates: Requirements 14.2, 18.6
 */

const root = path.resolve(__dirname, "../../..");
const read = (rel: string) => readFileSync(path.join(root, ...rel.split("/")), "utf8");

/** `uses` lists identifiers the file must reference directly. */
const sites: { file: string; uses: string[] }[] = [
  {
    file: "backend/domain/extraction/runDocument.ts",
    uses: ["ExtractorServiceProvider", "isExtractorConfigured"],
  },
  {
    file: "frontend/app/api/documents/classify-batch/route.ts",
    uses: ["ExtractorServiceProvider", "isExtractorConfigured"],
  },
  {
    file: "frontend/app/api/documents/[id]/type/route.ts",
    uses: ["ExtractorServiceProvider", "isExtractorConfigured"],
  },
  {
    file: "frontend/app/api/extract/route.ts",
    uses: ["ExtractorServiceProvider", "isExtractorConfigured"],
  },
  // Delegates to runDocumentExtraction and reports its extractor_not_configured code.
  { file: "frontend/app/api/documents/[id]/extract/route.ts", uses: ["extractor_not_configured"] },
  {
    file: "frontend/app/(app)/engagements/[id]/documents/page.tsx",
    uses: ["isExtractorConfigured"],
  },
  { file: "backend/inngest/functions/intake.ts", uses: ["isExtractorConfigured"] },
];

describe("extraction call sites", () => {
  it.each(sites)("$file does not use Gemini", ({ file }) => {
    const src = read(file);
    expect(src).not.toMatch(/GeminiExtractionProvider/);
    expect(src).not.toMatch(/isGeminiConfigured/);
    expect(src).not.toMatch(/extraction\/gemini["']/);
  });

  it.each(sites)("$file uses the extractor service", ({ file, uses }) => {
    const src = read(file);
    for (const name of uses) expect(src).toContain(name);
  });
});
