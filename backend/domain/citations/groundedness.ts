/**
 * Groundedness gate for citation drafts.
 *
 * Mirrors polishIsGrounded / extraction provenance: the model's claim must
 * appear in the source it was given. If it cites a clause, quote, or document
 * that is not in the retrieved set, the whole output is rejected and nothing
 * is attached.
 */

import {
  NO_APPLICABLE_CLAUSE,
  type CitationModelOutput,
  type RetrievedChunk,
} from "./types";

const CLAUSE_MENTION =
  /\b(?:para(?:graph)?|clause|section|article)\s+[\w.-]+(?:\s*\([a-z]\))?/gi;

export interface GroundednessResult {
  ok: boolean;
  reason: string;
  applicable: boolean;
}

function normalizeWs(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

function normalizeClause(s: string): string {
  return s
    .toLowerCase()
    .replace(/paragraph/g, "para")
    .replace(/section/g, "sec")
    .replace(/clause/g, "cl")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, "");
}

function tokenRecall(excerpt: string, source: string): number {
  const tokens = excerpt.split(/[^a-z0-9.]+/).filter((t) => t.length >= 4);
  if (tokens.length === 0) return 0;
  const hits = tokens.filter((t) => source.includes(t)).length;
  return hits / tokens.length;
}

/** Exact substring or close match against one retrieved chunk's verbatim text. */
export function closeTextMatch(excerpt: string, source: string): boolean {
  const a = normalizeWs(excerpt);
  const b = normalizeWs(source);
  if (!a || !b) return false;
  if (b.includes(a) || (a.length > 40 && a.includes(b.slice(0, 80)))) return true;
  if (a.length >= 24) {
    const core = a.slice(0, Math.min(96, a.length));
    if (b.includes(core)) return true;
  }
  return tokenRecall(a, b) >= 0.8;
}

export function chunkMatchesCitation(
  citation: { clauseRef: string; documentTitle: string; quotedText: string },
  chunk: RetrievedChunk
): boolean {
  const clauseOk =
    !chunk.clauseRef ||
    normalizeClause(citation.clauseRef) === normalizeClause(chunk.clauseRef) ||
    normalizeWs(chunk.chunkText).includes(normalizeWs(citation.clauseRef));
  if (!clauseOk) return false;

  const titleOk =
    normalizeWs(citation.documentTitle) === normalizeWs(chunk.documentTitle) ||
    closeTextMatch(citation.documentTitle, chunk.documentTitle);
  if (!titleOk) return false;

  return closeTextMatch(citation.quotedText, chunk.chunkText);
}

function strayClauseMentions(
  text: string,
  chunks: RetrievedChunk[]
): string[] {
  const allowed = new Set(
    chunks.flatMap((c) => {
      const refs = [normalizeClause(c.clauseRef ?? "")];
      const mentions = (c.chunkText.match(CLAUSE_MENTION) ?? []).map(normalizeClause);
      return [...refs, ...mentions].filter(Boolean);
    })
  );
  const found = text.match(CLAUSE_MENTION) ?? [];
  return found.filter((m) => {
    const n = normalizeClause(m);
    if (!n) return false;
    return ![...allowed].some((a) => a && (n === a || n.includes(a) || a.includes(n)));
  });
}

/**
 * Every citation string the model emitted must text-match a chunk it was given.
 * `applicable: false` (or empty citations) is the explicit no-match outcome.
 */
export function citationIsGrounded(
  output: CitationModelOutput,
  retrieved: RetrievedChunk[]
): GroundednessResult {
  if (!output.applicable || output.citations.length === 0) {
    return {
      ok: true,
      applicable: false,
      reason: NO_APPLICABLE_CLAUSE,
    };
  }

  if (retrieved.length === 0) {
    return {
      ok: false,
      applicable: false,
      reason: "Model cited a clause but no chunks were retrieved",
    };
  }

  for (const citation of output.citations) {
    const hit = retrieved.find((c) => chunkMatchesCitation(citation, c));
    if (!hit) {
      return {
        ok: false,
        applicable: true,
        reason: `Citation "${citation.clauseRef}" does not text-match any retrieved chunk`,
      };
    }
    const stray = strayClauseMentions(citation.explanation, retrieved);
    if (stray.length > 0) {
      return {
        ok: false,
        applicable: true,
        reason: `Explanation cites ${stray.join(", ")} which is outside the retrieved set`,
      };
    }
  }

  return { ok: true, applicable: true, reason: "All citations text-match retrieved chunks" };
}

export function pickGroundedChunk(
  output: CitationModelOutput,
  retrieved: RetrievedChunk[]
): { chunk: RetrievedChunk; explanation: string } | null {
  const gate = citationIsGrounded(output, retrieved);
  if (!gate.ok || !gate.applicable) return null;
  const first = output.citations[0];
  if (!first) return null;
  const chunk = retrieved.find((c) => chunkMatchesCitation(first, c));
  if (!chunk) return null;
  const extra = output.citations
    .slice(1)
    .map((c) => c.explanation)
    .filter(Boolean);
  const explanation = [first.explanation, ...extra].join(" ");
  return { chunk, explanation };
}
