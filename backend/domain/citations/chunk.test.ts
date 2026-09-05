import { describe, expect, it } from "vitest";
import { chunkByClauseBoundary, estimateTokens, splitSections } from "./chunk";

const BODY = `
=== Clause ADEETIE-SYN-3.1 | page 4 ===
Udyam Registration. An MSME applying under ADEETIE shall hold a valid Udyam Registration Number.

=== Clause ADEETIE-SYN-3.2 | page 5 ===
Notified cluster. The enterprise must operate in a notified cluster for the sector.
`.trim();

describe("clause-boundary chunking", () => {
  it("splits on clause markers and keeps verbatim section text", () => {
    const sections = splitSections(BODY);
    expect(sections).toHaveLength(2);
    expect(sections[0]?.clauseRef).toBe("ADEETIE-SYN-3.1");
    expect(sections[0]?.pageNumber).toBe(4);
    expect(BODY).toContain(sections[0]!.text);
  });

  it("never paraphrases: every chunk is a substring of the source", () => {
    const chunks = chunkByClauseBoundary(BODY);
    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      expect(BODY.includes(chunk.chunkText)).toBe(true);
    }
  });

  it("windows a long clause with overlap without rewriting it", () => {
    const token = "verbatim";
    const long = `${token} `.repeat(800).trim();
    const source = `=== Clause LONG-1 | page 1 ===\n${long}`;
    const chunks = chunkByClauseBoundary(source, { maxTokens: 200, overlapTokens: 40 });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]?.clauseRef).toBe("LONG-1");
    for (const chunk of chunks) {
      expect(source.includes(chunk.chunkText)).toBe(true);
      expect(estimateTokens(chunk.chunkText)).toBeLessThanOrEqual(200);
    }
  });
});
