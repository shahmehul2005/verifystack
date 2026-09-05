/**
 * Gemini embeddings for regulatory chunks and finding queries.
 *
 * Fail loud: an unset key or a zero/wrong-dimension vector is an error.
 * A silent zero vector would make every chunk look equally similar.
 */

import "server-only";
import { GoogleGenAI } from "@google/genai";
import {
  EMBEDDING_DIM,
  EMBEDDING_MODEL,
  EmbeddingError,
} from "./types";

export type EmbeddingTask = "RETRIEVAL_QUERY" | "RETRIEVAL_DOCUMENT";

function requireApiKey(): string {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    throw new EmbeddingError(
      "GEMINI_API_KEY is required to embed regulatory text — refusing to return a zero vector"
    );
  }
  return key;
}

function assertEmbedding(values: number[] | undefined, label: string): number[] {
  if (!values || values.length === 0) {
    throw new EmbeddingError(`${label}: embedding provider returned no values`);
  }
  if (values.length !== EMBEDDING_DIM) {
    throw new EmbeddingError(
      `${label}: expected ${EMBEDDING_DIM}-d embedding from ${EMBEDDING_MODEL}, got ${values.length}`
    );
  }
  if (values.every((v) => v === 0)) {
    throw new EmbeddingError(`${label}: embedding provider returned a zero vector`);
  }
  return values;
}

export async function embedTexts(
  texts: string[],
  task: EmbeddingTask
): Promise<number[][]> {
  if (texts.length === 0) return [];
  const apiKey = requireApiKey();
  const client = new GoogleGenAI({ apiKey });
  const response = await client.models.embedContent({
    model: EMBEDDING_MODEL,
    contents: texts,
    config: {
      outputDimensionality: EMBEDDING_DIM,
      taskType: task,
    },
  });
  const embeddings = response.embeddings ?? [];
  if (embeddings.length !== texts.length) {
    throw new EmbeddingError(
      `embedContent returned ${embeddings.length} vectors for ${texts.length} inputs`
    );
  }
  return embeddings.map((e, i) =>
    assertEmbedding(e.values, `input ${i}`)
  );
}

export async function embedText(
  text: string,
  task: EmbeddingTask = "RETRIEVAL_QUERY"
): Promise<number[]> {
  const [vec] = await embedTexts([text], task);
  if (!vec) {
    throw new EmbeddingError("embedContent returned no embedding");
  }
  return vec;
}
