/**
 * Ingest regulatory documents into regulatory_documents / regulatory_chunks.
 *
 * PRODUCTION INGESTION MUST USE REAL BEE DOCUMENTS. The default corpus is a
 * clearly labelled synthetic fixture for demo and tests. chunk_text is
 * stored verbatim — this module must not paraphrase.
 */

import "server-only";
import { createHash } from "node:crypto";
import { chunkByClauseBoundary } from "./chunk";
import { SYNTHETIC_CORPUS, SYNTHETIC_CORPUS_CAVEAT, type CorpusDocument } from "./corpus";
import { embedTexts } from "./embed";
import { CitationError, type PackSchemeName } from "./types";

export function rawFileHash(source: string): string {
  return createHash("sha256").update(source, "utf8").digest("hex");
}

export interface PlannedDocument {
  title: string;
  scheme: PackSchemeName;
  sectorOrCluster: string;
  sourceUrl: string;
  effectiveDate: string;
  rawFileHash: string;
  chunks: Array<{ clauseRef: string | null; pageNumber: number | null; chunkText: string }>;
}

export function planDocument(doc: CorpusDocument): PlannedDocument {
  const chunks = chunkByClauseBoundary(doc.body);
  for (const chunk of chunks) {
    if (!doc.body.includes(chunk.chunkText)) {
      throw new CitationError("ingest refused a non-verbatim chunk");
    }
  }
  return {
    title: doc.title,
    scheme: doc.scheme,
    sectorOrCluster: doc.sectorOrCluster,
    sourceUrl: doc.sourceUrl,
    effectiveDate: doc.effectiveDate,
    rawFileHash: rawFileHash(doc.body),
    chunks,
  };
}

interface InsertResult {
  data: { id: string } | null;
  error: { message: string } | null;
}

/**
 * `regulatory_documents` / `regulatory_chunks` arrive with migration 0010
 * and are not described by the hand-written Database types.
 */
export interface CitationIngestDb {
  from(table: "regulatory_documents"): {
    select(columns: string): {
      eq(column: string, value: string): {
        maybeSingle(): Promise<{ data: { id: string } | null; error: { message: string } | null }>;
      };
    };
    insert(values: Record<string, unknown>): {
      select(columns: string): { single(): Promise<InsertResult> };
    };
  };
  from(table: "regulatory_chunks"): {
    insert(values: Record<string, unknown>[]): PromiseLike<{ error: { message: string } | null }>;
  };
}

export interface IngestReport {
  caveat: string;
  documentsInserted: number;
  documentsSkipped: number;
  chunksInserted: number;
}

export async function ingestDocuments(
  supabase: CitationIngestDb,
  documents: CorpusDocument[]
): Promise<IngestReport> {
  let documentsInserted = 0;
  let documentsSkipped = 0;
  let chunksInserted = 0;

  for (const doc of documents) {
    const planned = planDocument(doc);
    const existing = await supabase
      .from("regulatory_documents")
      .select("id")
      .eq("raw_file_hash", planned.rawFileHash)
      .maybeSingle();
    if (existing.error) throw new CitationError(existing.error.message);
    if (existing.data) {
      documentsSkipped += 1;
      continue;
    }

    const inserted = await supabase
      .from("regulatory_documents")
      .insert({
        title: planned.title,
        scheme: planned.scheme,
        sector_or_cluster: planned.sectorOrCluster,
        source_url: planned.sourceUrl,
        effective_date: planned.effectiveDate,
        raw_file_hash: planned.rawFileHash,
      })
      .select("id")
      .single();
    if (inserted.error || !inserted.data) {
      throw new CitationError(inserted.error?.message ?? "document insert returned no id");
    }

    const embeddings = await embedTexts(
      planned.chunks.map((c) => c.chunkText),
      "RETRIEVAL_DOCUMENT"
    );

    const rows = planned.chunks.map((chunk, i) => ({
      document_id: inserted.data!.id,
      clause_ref: chunk.clauseRef,
      page_number: chunk.pageNumber,
      chunk_text: chunk.chunkText,
      embedding: `[${embeddings[i]!.join(",")}]`,
    }));

    const chunkInsert = await supabase.from("regulatory_chunks").insert(rows);
    if (chunkInsert.error) throw new CitationError(chunkInsert.error.message);

    documentsInserted += 1;
    chunksInserted += rows.length;
  }

  return {
    caveat: SYNTHETIC_CORPUS_CAVEAT,
    documentsInserted,
    documentsSkipped,
    chunksInserted,
  };
}

export async function ingestSyntheticCorpus(
  supabase: CitationIngestDb
): Promise<IngestReport> {
  return ingestDocuments(supabase, SYNTHETIC_CORPUS);
}
