/**
 * Script to parse PDFs and ingest them into the pgvector database.
 * Usage:
 *   npx tsx --conditions=react-server --tsconfig backend/tsconfig.json backend/scripts/ingestPdf.ts --dir d:/verifystack/pdfs --purge-synthetic
 */

import { readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse");
import { createServiceClient } from "@verifystack/backend/lib/supabase/admin";
import { ingestDocuments } from "@verifystack/backend/domain/citations/ingest";
import type { CitationIngestDb } from "@verifystack/backend/domain/citations/ingest";
import type { CorpusDocument } from "@verifystack/backend/domain/citations/corpus";
import type { PackSchemeName } from "@verifystack/backend/domain/citations/types";

function loadEnvLocal() {
  const path = resolve("frontend/.env.local");
  try {
    const text = readFileSync(path, "utf8");
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq < 1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    // Env may already be in the process.
  }
}

async function parsePdfText(buffer: Buffer): Promise<string> {
  const options = {
    pagerender: async (pageData: { getTextContent: () => Promise<{ items: Array<{ str: string }> }>; pageIndex: number }) => {
      const textContent = await pageData.getTextContent();
      let text = "";
      for (const item of textContent.items) {
        text += item.str + " ";
      }
      return `\n\n=== Clause page-${pageData.pageIndex + 1} | page ${pageData.pageIndex + 1} ===\n${text}\n\n`;
    },
  };
  const data = await pdfParse(buffer, options);
  return data.text;
}

async function run() {
  loadEnvLocal();

  const supabase = createServiceClient();
  if (!supabase) {
    throw new Error("Supabase service role is not configured");
  }

  const args = process.argv.slice(2);
  const purgeSynthetic = args.includes("--purge-synthetic");
  
  const dirIndex = args.indexOf("--dir");
  const targetDir = dirIndex >= 0 ? args[dirIndex + 1] : resolve("pdfs");

  if (purgeSynthetic) {
    console.log("Purging all regulatory documents to do a fresh ingest...");
    // We truncate to wipe partial/failed inserts from previous runs.
    const { error } = await supabase.from("regulatory_documents").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    if (error) {
      console.error("Error deleting data:", error);
    } else {
      console.log("Database cleared successfully.");
    }
  }

  const docsToIngest: CorpusDocument[] = [];

  try {
    const files = readdirSync(targetDir);
    for (const file of files) {
      if (file.toLowerCase().endsWith(".pdf")) {
        const filePath = join(targetDir, file);
        console.log(`Extracting text from ${file}...`);
        const buffer = readFileSync(filePath);
        const text = await parsePdfText(buffer);
        
        // For automation, we assume ADEETIE and Foundry as default or derived from filename if needed.
        // CCTS Cement can be added later if needed.
        let scheme: PackSchemeName = "ADEETIE";
        let sector = "Foundry";

        if (file.toLowerCase().includes("ccts") || file.toLowerCase().includes("cement")) {
           scheme = "CCTS";
           sector = "Cement";
        }

        docsToIngest.push({
          title: file,
          scheme,
          sectorOrCluster: sector,
          sourceUrl: `file://${filePath}`,
          effectiveDate: new Date().toISOString().split("T")[0],
          body: text,
          synthetic: true,
        });
        console.log(`Queued ${file} for ingestion (${text.length} chars).`);
      }
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Could not read directory ${targetDir}:`, message);
  }

  if (docsToIngest.length > 0) {
    console.log(`Ingesting ${docsToIngest.length} PDFs into Supabase...`);
    const report = await ingestDocuments(supabase as unknown as CitationIngestDb, docsToIngest);
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log("No PDFs found to ingest.");
  }
}

run().catch(console.error);
