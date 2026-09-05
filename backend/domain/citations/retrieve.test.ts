import { describe, expect, it } from "vitest";
import { chunkByClauseBoundary } from "./chunk";
import { SYNTHETIC_CORPUS } from "./corpus";
import { mockEmbedding } from "./mockEmbed";
import { cosineSimilarity, filterThenRank, matchesPack } from "./rank";
import { EMBEDDING_DIM, MIN_RETRIEVAL_COSINE } from "./types";
import type { RankableChunk } from "./rank";

function corpusChunks(): RankableChunk[] {
  return SYNTHETIC_CORPUS.flatMap((doc) =>
    chunkByClauseBoundary(doc.body).map((c) => ({
      clauseRef: c.clauseRef,
      pageNumber: c.pageNumber,
      chunkText: c.chunkText,
      documentTitle: doc.title,
      sourceUrl: doc.sourceUrl,
      scheme: doc.scheme,
      sectorOrCluster: doc.sectorOrCluster,
      embedding: mockEmbedding(`${c.clauseRef ?? ""} ${c.chunkText}`),
    }))
  );
}

describe("filter-then-rank", () => {
  const chunks = corpusChunks();

  it("filters by scheme and sector before ranking", () => {
    const adeetie = chunks.filter((c) =>
      matchesPack(c, { scheme: "ADEETIE", sectorOrCluster: "Foundry" })
    );
    expect(adeetie.every((c) => c.scheme === "ADEETIE")).toBe(true);
    expect(adeetie.some((c) => c.scheme === "CCTS")).toBe(false);
  });

  it("does not return CCTS chunks for an ADEETIE Foundry query", () => {
    const query = mockEmbedding("Udyam Registration Number MSME Udyam-registered");
    const ranked = filterThenRank(chunks, query, {
      scheme: "ADEETIE",
      sectorOrCluster: "Foundry",
    });
    expect(ranked.every((c) => c.scheme === "ADEETIE")).toBe(true);
  });

  it("refuses a zero vector", () => {
    expect(() =>
      cosineSimilarity(new Array(EMBEDDING_DIM).fill(0), mockEmbedding("udyam registration number"))
    ).toThrow(/zero-vector/);
  });

  it("drops neighbours below the cosine floor", () => {
    const query = mockEmbedding(
      "ISO 50001 energy management system certification melting shop certificate"
    );
    const ranked = filterThenRank(chunks, query, {
      scheme: "ADEETIE",
      sectorOrCluster: "Foundry",
    });
    expect(ranked.every((c) => c.similarity >= MIN_RETRIEVAL_COSINE)).toBe(true);
  });
});
