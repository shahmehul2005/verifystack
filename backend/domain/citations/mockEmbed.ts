import { EMBEDDING_DIM } from "./types";

/**
 * Deterministic bag-of-words embedding for tests. Same dimension as
 * gemini-embedding-001 (1536). Never used in production retrieval.
 */
export function mockEmbedding(text: string, dim = EMBEDDING_DIM): number[] {
  const vec = new Array<number>(dim).fill(0);
  const tokens = text.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 3);
  for (const token of tokens) {
    let h = 2166136261;
    for (let i = 0; i < token.length; i++) {
      h ^= token.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    const idx = (h >>> 0) % dim;
    vec[idx] += 1;
  }
  const norm = Math.sqrt(vec.reduce((s, x) => s + x * x, 0));
  if (norm === 0) {
    throw new Error("mockEmbedding refused to return a zero vector");
  }
  return vec.map((x) => x / norm);
}
