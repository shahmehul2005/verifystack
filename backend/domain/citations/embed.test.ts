import { afterEach, describe, expect, it } from "vitest";
import { embedText } from "./embed";
import { EmbeddingError } from "./types";

describe("embedText", () => {
  const previous = process.env.GEMINI_API_KEY;

  afterEach(() => {
    if (previous === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previous;
  });

  it("throws when GEMINI_API_KEY is unset rather than returning a zero vector", async () => {
    delete process.env.GEMINI_API_KEY;
    await expect(embedText("Udyam Registration")).rejects.toBeInstanceOf(EmbeddingError);
    await expect(embedText("Udyam Registration")).rejects.toThrow(/GEMINI_API_KEY/);
  });
});
