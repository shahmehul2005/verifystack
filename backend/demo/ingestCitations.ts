/**
 * Runnable ingest for the synthetic citation corpus.
 *
 * PRODUCTION INGESTION MUST USE REAL BEE DOCUMENTS. This entrypoint only
 * loads the labelled fixture in domain/citations/corpus.ts.
 *
 *   npx tsx --tsconfig backend/tsconfig.json backend/demo/ingestCitations.ts
 *
 * Reads frontend/.env.local when present. Needs GEMINI_API_KEY and
 * Supabase service role. Enable pgvector before running.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createServiceClient } from "@verifystack/backend/lib/supabase/admin";
import { ingestSyntheticCorpus } from "@verifystack/backend/domain/citations/ingest";
import type { CitationIngestDb } from "@verifystack/backend/domain/citations/ingest";

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

loadEnvLocal();

const supabase = createServiceClient();
if (!supabase) {
  throw new Error("Supabase service role is not configured");
}

const report = await ingestSyntheticCorpus(supabase as unknown as CitationIngestDb);
console.log(JSON.stringify(report, null, 2));
