/**
 * Regulatory citation assistant.
 *
 * Retrieval, not recall: the model may only talk about chunks we fetched for
 * this finding. Everything starts `suggested`. A citation that cannot be
 * grounded in those chunks is dropped, never shown as if it were real.
 */

export const EMBEDDING_MODEL = "gemini-embedding-001";
/** Must match VECTOR(1536) in 0010_regulatory_citations.sql. */
export const EMBEDDING_DIM = 1536;

export const CITATION_TOP_K = 5;
export const CITATION_TOP_K_MIN = 3;

/**
 * Below this cosine, a retrieved neighbour is not "clearly related".
 * Unrelated top-k hits are the usual failure mode of always returning k rows.
 */
export const MIN_RETRIEVAL_COSINE = 0.28;

export const CITATION_SYSTEM_INSTRUCTION =
  "Only cite clauses present in the provided context. If none of the provided chunks clearly apply, say so explicitly — do not cite anything else.";

export const NO_APPLICABLE_CLAUSE = "no applicable clause found";

export const CITATION_PROMPT_VERSION = "2026-09-05.cite-retrieved-only";

export type PackSchemeName = "PAT" | "CCTS" | "ADEETIE";

export type CitationState = "suggested" | "accepted" | "edited" | "rejected" | "none";
export type CitationGate =
  | "grounded"
  | "rejected"
  | "no_applicable_clause"
  | "unavailable";

export interface PackFilter {
  scheme: string;
  sectorOrCluster: string;
}

export interface RetrievedChunk {
  id?: string;
  documentId?: string;
  clauseRef: string | null;
  pageNumber: number | null;
  chunkText: string;
  documentTitle: string;
  sourceUrl: string;
  scheme: string;
  sectorOrCluster: string | null;
  similarity: number;
  embedding?: number[];
}

export interface CitationDraftItem {
  clauseRef: string;
  documentTitle: string;
  pageNumber: number | null;
  quotedText: string;
  explanation: string;
}

export interface CitationModelOutput {
  applicable: boolean;
  noApplicableClause?: string | null;
  citations: CitationDraftItem[];
}

export interface FindingCitationColumns {
  citation_state: CitationState | null;
  citation_gate: CitationGate | null;
  citation_clause_ref: string | null;
  citation_chunk_text: string | null;
  citation_document_title: string | null;
  citation_page_number: number | null;
  citation_source_url: string | null;
  citation_chunk_id: string | null;
  citation_explanation: string | null;
}

export type CitationAttachment =
  | {
      kind: "grounded";
      state: "suggested";
      gate: "grounded";
      chunk: RetrievedChunk;
      explanation: string;
      columns: FindingCitationColumns;
    }
  | {
      kind: "no_applicable_clause";
      state: "none";
      gate: "no_applicable_clause";
      columns: FindingCitationColumns;
    }
  | {
      kind: "rejected";
      state: "none";
      gate: "rejected";
      reason: string;
      columns: FindingCitationColumns;
    }
  | {
      kind: "unavailable";
      state: "none";
      gate: "unavailable";
      reason: string;
      columns: FindingCitationColumns;
    };

export interface CiteDeps {
  embed(text: string, task: "RETRIEVAL_QUERY" | "RETRIEVAL_DOCUMENT"): Promise<number[]>;
  retrieve(queryEmbedding: number[], filter: PackFilter): Promise<RetrievedChunk[]>;
  draft(findingTitle: string, findingDetail: string, chunks: RetrievedChunk[]): Promise<CitationModelOutput>;
}

export class EmbeddingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmbeddingError";
  }
}

export class CitationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CitationError";
  }
}

export function emptyCitationColumns(
  gate: CitationGate,
  explanation: string | null
): FindingCitationColumns {
  return {
    citation_state: "none",
    citation_gate: gate,
    citation_clause_ref: null,
    citation_chunk_text: null,
    citation_document_title: null,
    citation_page_number: null,
    citation_source_url: null,
    citation_chunk_id: null,
    citation_explanation: explanation,
  };
}

const CITATION_STATES = new Set<CitationState>([
  "suggested",
  "accepted",
  "edited",
  "rejected",
  "none",
]);
const CITATION_GATES = new Set<CitationGate>([
  "grounded",
  "rejected",
  "no_applicable_clause",
  "unavailable",
]);

export function readFindingCitation(row: object): FindingCitationColumns {
  const r = row as Record<string, unknown>;
  const state = typeof r.citation_state === "string" && CITATION_STATES.has(r.citation_state as CitationState)
    ? (r.citation_state as CitationState)
    : null;
  const gate = typeof r.citation_gate === "string" && CITATION_GATES.has(r.citation_gate as CitationGate)
    ? (r.citation_gate as CitationGate)
    : null;
  return {
    citation_state: state,
    citation_gate: gate,
    citation_clause_ref: typeof r.citation_clause_ref === "string" ? r.citation_clause_ref : null,
    citation_chunk_text: typeof r.citation_chunk_text === "string" ? r.citation_chunk_text : null,
    citation_document_title: typeof r.citation_document_title === "string" ? r.citation_document_title : null,
    citation_page_number:
      typeof r.citation_page_number === "number" ? r.citation_page_number : null,
    citation_source_url: typeof r.citation_source_url === "string" ? r.citation_source_url : null,
    citation_chunk_id: typeof r.citation_chunk_id === "string" ? r.citation_chunk_id : null,
    citation_explanation: typeof r.citation_explanation === "string" ? r.citation_explanation : null,
  };
}

export function groundedCitationColumns(
  chunk: RetrievedChunk,
  explanation: string
): FindingCitationColumns {
  return {
    citation_state: "suggested",
    citation_gate: "grounded",
    citation_clause_ref: chunk.clauseRef,
    citation_chunk_text: chunk.chunkText,
    citation_document_title: chunk.documentTitle,
    citation_page_number: chunk.pageNumber,
    citation_source_url: chunk.sourceUrl,
    citation_chunk_id: chunk.id ?? null,
    citation_explanation: explanation,
  };
}
