import {
  CITATION_TOP_K,
  CITATION_TOP_K_MIN,
  MIN_RETRIEVAL_COSINE,
  type PackFilter,
  type RetrievedChunk,
} from "./types";

export interface RankableChunk {
  id?: string;
  documentId?: string;
  clauseRef: string | null;
  pageNumber: number | null;
  chunkText: string;
  documentTitle: string;
  sourceUrl: string;
  scheme: string;
  sectorOrCluster: string | null;
  embedding: number[];
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`embedding dimension mismatch: ${a.length} vs ${b.length}`);
  }
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  if (denom === 0) {
    throw new Error("zero-vector embedding is not allowed");
  }
  return dot / denom;
}

export function matchesPack(chunk: RankableChunk, filter: PackFilter): boolean {
  if (chunk.scheme !== filter.scheme) return false;
  if (chunk.sectorOrCluster == null) return true;
  return chunk.sectorOrCluster === filter.sectorOrCluster;
}

/**
 * Filter by scheme + sector, then cosine top 3–5.
 * Chunks below MIN_RETRIEVAL_COSINE are dropped so an unrelated neighbour
 * is not treated as a candidate.
 */
export function filterThenRank(
  chunks: RankableChunk[],
  queryEmbedding: number[],
  filter: PackFilter,
  topK = CITATION_TOP_K
): RetrievedChunk[] {
  const k = Math.min(Math.max(topK, CITATION_TOP_K_MIN), CITATION_TOP_K);
  const filtered = chunks.filter((c) => matchesPack(c, filter));
  return filtered
    .map((c) => ({
      id: c.id,
      documentId: c.documentId,
      clauseRef: c.clauseRef,
      pageNumber: c.pageNumber,
      chunkText: c.chunkText,
      documentTitle: c.documentTitle,
      sourceUrl: c.sourceUrl,
      scheme: c.scheme,
      sectorOrCluster: c.sectorOrCluster,
      similarity: cosineSimilarity(queryEmbedding, c.embedding),
      embedding: c.embedding,
    }))
    .filter((c) => c.similarity >= MIN_RETRIEVAL_COSINE)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, k);
}
