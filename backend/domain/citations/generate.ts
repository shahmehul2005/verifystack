/**
 * Citation draft from retrieved chunks only.
 *
 * The model never sees the open web or its training memory of BEE text —
 * only the chunks passed in. Output is parsed and later groundedness-gated.
 */

import "server-only";
import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import {
  CITATION_PROMPT_VERSION,
  CITATION_SYSTEM_INSTRUCTION,
  CitationError,
  NO_APPLICABLE_CLAUSE,
  type CitationModelOutput,
  type RetrievedChunk,
} from "./types";

const CitationDraftSchema = z.object({
  applicable: z.boolean(),
  noApplicableClause: z.string().nullable().optional(),
  citations: z.array(
    z.object({
      clauseRef: z.string().min(1),
      documentTitle: z.string().min(1),
      pageNumber: z.number().int().positive().nullish(),
      quotedText: z.string().min(1),
      explanation: z.string().min(1),
    })
  ),
});

function stripCodeFence(raw: string): string {
  const trimmed = raw.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/;
  const m = trimmed.match(fence);
  return m ? m[1]! : trimmed;
}

export function formatRetrievedContext(chunks: RetrievedChunk[]): string {
  return chunks
    .map(
      (c, i) =>
        `[${i + 1}] title=${c.documentTitle}\nclause=${c.clauseRef ?? "(none)"}\npage=${c.pageNumber ?? "(none)"}\nurl=${c.sourceUrl}\nverbatim:\n${c.chunkText}`
    )
    .join("\n\n");
}

export function buildCitationPrompt(
  findingTitle: string,
  findingDetail: string,
  chunks: RetrievedChunk[]
): string {
  return `${CITATION_SYSTEM_INSTRUCTION}

A reconciliation rule has fired. Using ONLY the retrieved chunks below, explain why a clause applies, or say that none apply. Do not compute. Do not add numbers, clause references, or document titles that are not in the provided chunks.

FINDING TITLE: ${findingTitle}
FINDING DETAIL: ${findingDetail}

RETRIEVED CHUNKS:
${formatRetrievedContext(chunks)}

Return JSON of the form:
{
  "applicable": <boolean>,
  "noApplicableClause": <"${NO_APPLICABLE_CLAUSE}" when applicable is false, else null>,
  "citations": [
    {
      "clauseRef": <must equal a provided chunk's clause value>,
      "documentTitle": <must equal a provided chunk's title>,
      "pageNumber": <number or null>,
      "quotedText": <verbatim substring of that chunk's verbatim text>,
      "explanation": <why this chunk applies to the finding>
    }
  ]
}

When none of the provided chunks clearly apply, set applicable to false, citations to [], and noApplicableClause to "${NO_APPLICABLE_CLAUSE}".
Prompt version: ${CITATION_PROMPT_VERSION}`;
}

export function parseCitationModelOutput(raw: string): CitationModelOutput {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFence(raw));
  } catch {
    throw new CitationError("Model output was not valid JSON");
  }
  const result = CitationDraftSchema.safeParse(parsed);
  if (!result.success) {
    throw new CitationError(
      result.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")
    );
  }
  return {
    applicable: result.data.applicable,
    noApplicableClause: result.data.noApplicableClause,
    citations: result.data.citations.map((c) => ({
      clauseRef: c.clauseRef,
      documentTitle: c.documentTitle,
      pageNumber: c.pageNumber ?? null,
      quotedText: c.quotedText,
      explanation: c.explanation,
    })),
  };
}

export async function draftCitationFromChunks(
  findingTitle: string,
  findingDetail: string,
  chunks: RetrievedChunk[]
): Promise<CitationModelOutput> {
  if (chunks.length === 0) {
    return { applicable: false, noApplicableClause: NO_APPLICABLE_CLAUSE, citations: [] };
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new CitationError(
      "GEMINI_API_KEY is required to draft a citation explanation — refusing to invent one"
    );
  }

  const model = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
  const client = new GoogleGenAI({ apiKey });
  const response = await client.models.generateContent({
    model,
    contents: [
      {
        role: "user",
        parts: [{ text: buildCitationPrompt(findingTitle, findingDetail, chunks) }],
      },
    ],
    config: {
      temperature: 0,
      responseMimeType: "application/json",
      systemInstruction: CITATION_SYSTEM_INSTRUCTION,
    },
  });

  const raw = response.text ?? "";
  if (!raw.trim()) {
    throw new CitationError("Citation model returned empty output");
  }
  return parseCitationModelOutput(raw);
}
