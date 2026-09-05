import { describe, expect, it } from "vitest";
import { citationIsGrounded, closeTextMatch } from "./groundedness";
import { NO_APPLICABLE_CLAUSE, type RetrievedChunk } from "./types";

const chunk: RetrievedChunk = {
  clauseRef: "ADEETIE-SYN-3.1",
  pageNumber: 4,
  chunkText:
    "Udyam Registration. An MSME applying under ADEETIE shall hold a valid Udyam Registration Number as printed on the Udyam Registration Certificate.",
  documentTitle: "[SYNTHETIC] ADEETIE Operational Guidelines — Foundry",
  sourceUrl: "https://example.invalid/verifystack/synthetic/adeetie-foundry-guidelines",
  scheme: "ADEETIE",
  sectorOrCluster: "Foundry",
  similarity: 0.81,
};

describe("citation groundedness", () => {
  it("accepts a quote that is a substring of the retrieved chunk", () => {
    const r = citationIsGrounded(
      {
        applicable: true,
        citations: [
          {
            clauseRef: "ADEETIE-SYN-3.1",
            documentTitle: chunk.documentTitle,
            pageNumber: 4,
            quotedText: "shall hold a valid Udyam Registration Number",
            explanation: "The finding records no Udyam Registration Number, which ADEETIE-SYN-3.1 requires.",
          },
        ],
      },
      [chunk]
    );
    expect(r.ok).toBe(true);
    expect(r.applicable).toBe(true);
  });

  it("rejects a clause that is not in the retrieved set", () => {
    const r = citationIsGrounded(
      {
        applicable: true,
        citations: [
          {
            clauseRef: "Para 99.9",
            documentTitle: chunk.documentTitle,
            pageNumber: 99,
            quotedText: "Enterprises shall hold ISO 50001 certification",
            explanation: "ISO 50001 is required.",
          },
        ],
      },
      [chunk]
    );
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/does not text-match/i);
  });

  it("treats applicable:false as no applicable clause, not a forced citation", () => {
    const r = citationIsGrounded(
      { applicable: false, noApplicableClause: NO_APPLICABLE_CLAUSE, citations: [] },
      [chunk]
    );
    expect(r.ok).toBe(true);
    expect(r.applicable).toBe(false);
    expect(r.reason).toBe(NO_APPLICABLE_CLAUSE);
  });

  it("rejects an explanation that names a clause outside the retrieved set", () => {
    const r = citationIsGrounded(
      {
        applicable: true,
        citations: [
          {
            clauseRef: "ADEETIE-SYN-3.1",
            documentTitle: chunk.documentTitle,
            pageNumber: 4,
            quotedText: "valid Udyam Registration Number",
            explanation: "Also see Clause 99.9 of an unpublished handbook.",
          },
        ],
      },
      [chunk]
    );
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/outside the retrieved set/i);
  });

  it("close-matches whitespace-normalised quotes", () => {
    expect(
      closeTextMatch(
        "valid   Udyam Registration\nNumber",
        chunk.chunkText
      )
    ).toBe(true);
    expect(closeTextMatch("ISO 50001 energy management", chunk.chunkText)).toBe(false);
  });
});
