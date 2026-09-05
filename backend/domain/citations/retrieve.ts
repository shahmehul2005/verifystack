import "server-only";
import {
  CITATION_TOP_K,
  CitationError,
  MIN_RETRIEVAL_COSINE,
  type PackFilter,
  type RetrievedChunk,
} from "./types";

interface RpcRow {
  id: string;
  document_id: string;
  clause_ref: string | null;
  page_number: number | null;
  chunk_text: string;
  title: string;
  source_url: string;
  scheme: string;
  sector_or_cluster: string | null;
  similarity: number;
}

/**
 * `match_regulatory_chunks` arrives with migration 0010 and is not described
 * by the hand-written Database types.
 */
interface CitationRpc {
  rpc(
    fn: "match_regulatory_chunks",
    args: {
      query_embedding: number[];
      p_scheme: string;
      p_sector: string;
      match_count: number;
    }
  ): PromiseLike<{ data: RpcRow[] | null; error: { message: string } | null }>;
}

export async function retrieveFromDb(
  supabase: CitationRpc,
  queryEmbedding: number[],
  filter: PackFilter,
  topK = CITATION_TOP_K
): Promise<RetrievedChunk[]> {
  if (queryEmbedding.length === 0 || queryEmbedding.every((v) => v === 0)) {
    throw new CitationError("refusing to retrieve against a zero query embedding");
  }

  const { data, error } = await supabase.rpc("match_regulatory_chunks", {
    query_embedding: queryEmbedding,
    p_scheme: filter.scheme,
    p_sector: filter.sectorOrCluster,
    match_count: topK,
  });
  if (error) {
    throw new CitationError(`citation retrieval failed: ${error.message}`);
  }

  return (data ?? [])
    .filter((row) => Number(row.similarity) >= MIN_RETRIEVAL_COSINE)
    .map((row) => ({
      id: row.id,
      documentId: row.document_id,
      clauseRef: row.clause_ref,
      pageNumber: row.page_number,
      chunkText: row.chunk_text,
      documentTitle: row.title,
      sourceUrl: row.source_url,
      scheme: row.scheme,
      sectorOrCluster: row.sector_or_cluster,
      similarity: Number(row.similarity),
    }));
}
