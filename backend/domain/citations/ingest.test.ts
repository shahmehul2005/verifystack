import { describe, expect, it } from "vitest";
import { SYNTHETIC_CORPUS, SYNTHETIC_CORPUS_CAVEAT } from "./corpus";
import { planDocument } from "./ingest";

describe("ingest plan", () => {
  it("keeps verbatim chunk text and hashes the source", () => {
    expect(SYNTHETIC_CORPUS_CAVEAT).toMatch(/real BEE/i);
    for (const doc of SYNTHETIC_CORPUS) {
      expect(doc.synthetic).toBe(true);
      expect(doc.title).toMatch(/SYNTHETIC/);
      const planned = planDocument(doc);
      expect(planned.rawFileHash).toMatch(/^[a-f0-9]{64}$/);
      expect(planned.chunks.length).toBeGreaterThan(0);
      for (const chunk of planned.chunks) {
        expect(doc.body.includes(chunk.chunkText)).toBe(true);
      }
    }
  });
});
