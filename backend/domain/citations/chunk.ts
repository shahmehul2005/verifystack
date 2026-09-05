/**
 * Clause-boundary chunking.
 *
 * A clause split mid-sentence is useless for citation. We split on the
 * `=== Clause … ===` markers the fixture (and a production parser) emit, then
 * only window a section when it exceeds the token budget. Every emitted
 * `chunkText` is a verbatim slice of the source — never paraphrased, never
 * whitespace-normalised.
 */

export interface ClauseSection {
  clauseRef: string | null;
  pageNumber: number | null;
  text: string;
}

export interface ClauseChunk {
  clauseRef: string | null;
  pageNumber: number | null;
  chunkText: string;
}

export interface ChunkOptions {
  minTokens?: number;
  maxTokens?: number;
  overlapTokens?: number;
}

const HEADER =
  /^===\s*Clause\s+(\S+)\s*(?:\|\s*page\s+(\d+))?\s*===\s*$/;

const DEFAULT_MAX_TOKENS = 520;
const DEFAULT_OVERLAP_TOKENS = 70;

interface TokenSpan {
  start: number;
  end: number;
}

function tokenSpans(text: string): TokenSpan[] {
  const spans: TokenSpan[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    spans.push({ start: m.index, end: m.index + m[0].length });
  }
  return spans;
}

export function estimateTokens(text: string): number {
  return tokenSpans(text).length;
}

export function splitSections(body: string): ClauseSection[] {
  const lines = body.split(/\r?\n/);
  const sections: ClauseSection[] = [];
  let current: ClauseSection | null = null;
  const buf: string[] = [];

  const flush = () => {
    if (!current) return;
    const text = buf.join("\n").trim();
    if (text) sections.push({ ...current, text });
    buf.length = 0;
  };

  for (const line of lines) {
    const header = HEADER.exec(line.trim());
    if (header) {
      flush();
      current = {
        clauseRef: header[1] ?? null,
        pageNumber: header[2] ? Number(header[2]) : null,
        text: "",
      };
      continue;
    }
    if (!current) {
      current = { clauseRef: null, pageNumber: null, text: "" };
    }
    buf.push(line);
  }
  flush();
  return sections;
}

function windowVerbatim(
  text: string,
  maxTokens: number,
  overlapTokens: number
): string[] {
  const spans = tokenSpans(text);
  if (spans.length === 0) return [];
  if (spans.length <= maxTokens) return [text];

  const chunks: string[] = [];
  let startIdx = 0;
  while (startIdx < spans.length) {
    const endIdx = Math.min(startIdx + maxTokens, spans.length);
    const startChar = spans[startIdx]!.start;
    const endChar = spans[endIdx - 1]!.end;
    chunks.push(text.slice(startChar, endChar));
    if (endIdx >= spans.length) break;
    startIdx = Math.max(endIdx - overlapTokens, startIdx + 1);
  }
  return chunks;
}

/**
 * Chunk a marked-up source document. Each chunk_text is a substring of `body`
 * (after per-section trim of leading/trailing blank lines only on the section
 * as a whole — the interior is untouched).
 */
export function chunkByClauseBoundary(
  body: string,
  options: ChunkOptions = {}
): ClauseChunk[] {
  const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
  const overlapTokens = options.overlapTokens ?? DEFAULT_OVERLAP_TOKENS;
  const out: ClauseChunk[] = [];

  for (const section of splitSections(body)) {
    const windows = windowVerbatim(section.text, maxTokens, overlapTokens);
    for (const chunkText of windows) {
      if (!chunkText.trim()) continue;
      out.push({
        clauseRef: section.clauseRef,
        pageNumber: section.pageNumber,
        chunkText,
      });
    }
  }
  return out;
}
