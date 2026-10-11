/**
 * Deterministic lexical retrieval over the assistant's knowledge entries.
 *
 * This is the scope gate: a question that shares no meaningful vocabulary with
 * any entry is refused here, before a model is ever called.
 */

import { KNOWLEDGE, type KnowledgeEntry } from "./knowledge";

export interface RetrievedEntry {
  entry: KnowledgeEntry;
  score: number;
}

/** A keyword hit, or a title hit plus a body hit, is the least that counts as on-topic. */
export const MIN_ENTRY_SCORE = 3;
export const ASSISTANT_TOP_K = 4;
/** Entries scoring below this share of the best entry are noise, not context. */
const RELATIVE_FLOOR = 0.4;

const KEYWORD_WEIGHT = 3;
const TITLE_WEIGHT = 2;
const BODY_WEIGHT = 1;

const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "but", "if", "then", "so", "of", "to", "in", "on", "at", "by",
  "for", "from", "with", "about", "into", "over", "as", "is", "are", "was", "were", "be", "been",
  "being", "am", "do", "does", "did", "doing", "done", "have", "has", "had", "i", "me", "my",
  "we", "our", "us", "you", "your", "it", "its", "this", "that", "these", "those", "there",
  "what", "which", "whom", "whose", "when", "where", "why", "will", "would", "should",
  "could", "may", "might", "must", "shall", "not", "no", "yes", "any", "all", "some", "more",
  "most", "much", "many", "very", "just", "also", "too", "than", "such", "own", "same", "other",
  "tell", "please", "know", "want", "need", "like", "get", "got", "use", "using", "used", "make",
  "give", "show", "let", "say", "said", "one", "way", "thing", "things", "kind", "type", "really",
  "hi", "hello", "hey", "thanks", "thank", "ok", "okay", "how", "who", "can", "cannot", "help",
  "work", "works", "new", "start", "add", "best", "good", "find", "out", "up", "today", "now",
]);

function stem(token: string): string {
  if (token.length > 4 && token.endsWith("ies")) return `${token.slice(0, -3)}y`;
  if (token.length > 4 && token.endsWith("es") && /(?:ss|sh|ch|x)es$/.test(token)) {
    return token.slice(0, -2);
  }
  if (token.length > 3 && token.endsWith("s") && !token.endsWith("ss")) return token.slice(0, -1);
  return token;
}

/** Lowercase, fold "M&V" and "sign-off" into single tokens, drop stopwords, light stemming. */
export function tokenize(text: string): string[] {
  const folded = text
    .toLowerCase()
    .replace(/\bm\s*&\s*v\b/g, "mv")
    .replace(/\bsign(?:s|ed|ing)?[\s-]+(off|in|up)\b/g, "sign$1")
    .replace(/\blog[\s-]+in\b/g, "login")
    .replace(/\be-mail\b/g, "email");
  return folded
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t))
    .map(stem);
}

interface IndexedEntry {
  entry: KnowledgeEntry;
  keywords: Set<string>;
  title: Set<string>;
  body: Set<string>;
}

const INDEX: IndexedEntry[] = KNOWLEDGE.map((entry) => ({
  entry,
  keywords: new Set(entry.keywords.flatMap(tokenize)),
  title: new Set(tokenize(entry.title)),
  body: new Set(tokenize(entry.body)),
}));

function scoreEntry(queryTokens: Set<string>, indexed: IndexedEntry): number {
  let score = 0;
  for (const t of queryTokens) {
    if (indexed.keywords.has(t)) score += KEYWORD_WEIGHT;
    else if (indexed.title.has(t)) score += TITLE_WEIGHT;
    else if (indexed.body.has(t)) score += BODY_WEIGHT;
  }
  return score;
}

export function retrieveKnowledge(question: string, topK = ASSISTANT_TOP_K): RetrievedEntry[] {
  const queryTokens = new Set(tokenize(question));
  if (queryTokens.size === 0) return [];

  const scored = INDEX.map((indexed) => ({
    entry: indexed.entry,
    score: scoreEntry(queryTokens, indexed),
  }))
    .filter((r) => r.score >= MIN_ENTRY_SCORE)
    .sort((a, b) => b.score - a.score || a.entry.id.localeCompare(b.entry.id));

  const best = scored[0]?.score ?? 0;
  return scored.filter((r) => r.score >= best * RELATIVE_FLOOR).slice(0, topK);
}
