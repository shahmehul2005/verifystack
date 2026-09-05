import "server-only";

/**
 * Optional Gemini styling of a matched ECM row.
 *
 * The library row is the product. The model may turn that row's own fields into
 * one sentence. It must not add equipment, numbers, or claims absent from the
 * row. `styleIsGrounded` is the gate: a sentence that introduces anything new is
 * discarded and the caller shows the raw row unstyled.
 *
 * Mirrors `polishIsGrounded` in domain/ai/draftCar.ts, with a stricter
 * no-invention check because a fabricated ECM sentence has engineering cost.
 *
 * If GEMINI_API_KEY is unset, styling is skipped (raw row) — the feature still
 * works. A model or network failure is not an ECM failure.
 */

import { GoogleGenAI } from "@google/genai";
import type { EcmLibraryRow, StyledEcm } from "./types";

/**
 * Connective words the styling prompt is allowed to use. Anything else in the
 * sentence must already appear in the source row.
 */
const STYLE_GLUE = new Set([
  "based",
  "your",
  "usage",
  "consider",
  "typical",
  "savings",
  "source",
  "payback",
  "month",
  "months",
  "related",
  "from",
  "with",
  "this",
  "that",
  "than",
  "then",
  "the",
  "and",
  "for",
  "into",
  "have",
  "has",
  "been",
  "being",
  "name",
  "description",
  "range",
  "about",
  "under",
  "using",
  "used",
  "measure",
  "auditor",
  "facility",
  "because",
  "where",
  "when",
  "which",
  "their",
  "them",
  "also",
  "such",
  "only",
  "onto",
  "over",
  "after",
  "before",
  "between",
  "percentage",
  "percent",
]);

function sourceBlob(row: EcmLibraryRow): string {
  return [
    row.scheme ?? "",
    row.sectorOrCluster,
    row.equipmentTag,
    row.ecmName,
    row.description,
    row.typicalSavingsRange ?? "",
    row.typicalPaybackMonths == null ? "" : String(row.typicalPaybackMonths),
    row.sourceReference,
  ].join(" ");
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function extractNumbers(text: string): string[] {
  return [...text.matchAll(/\d+(?:\.\d+)?/g)].map((m) => m[0]);
}

function unstyled(row: EcmLibraryRow): StyledEcm {
  return {
    row,
    presentation: "raw_row",
    sentence: null,
    styled: false,
    generator: "none",
  };
}

/**
 * True only if `sentence` restates the row and introduces no equipment, number,
 * or claim that is not already in the row. Empty text fails.
 */
export function styleIsGrounded(row: EcmLibraryRow, sentence: string): boolean {
  if (!sentence.trim()) return false;

  const blob = sourceBlob(row);
  const nameLower = row.ecmName.toLowerCase();
  const sentenceLower = sentence.toLowerCase();

  if (!sentenceLower.includes(nameLower)) {
    const nameTokens = tokenize(row.ecmName).filter((t) => t.length >= 4);
    const hits = nameTokens.filter((t) => sentenceLower.includes(t)).length;
    if (hits < Math.min(2, nameTokens.length)) return false;
  }

  const sourceNums = new Set(extractNumbers(blob));
  for (const n of extractNumbers(sentence)) {
    if (!sourceNums.has(n)) return false;
  }

  const sourceTokens = new Set(tokenize(blob));
  for (const token of tokenize(sentence)) {
    if (token.length < 4) continue;
    if (STYLE_GLUE.has(token)) continue;
    if (!sourceTokens.has(token)) return false;
  }

  return true;
}

function stripCodeFence(raw: string): string {
  const trimmed = raw.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/;
  const m = trimmed.match(fence);
  return m ? m[1]! : trimmed;
}

/**
 * Turn a matched row into one sentence, or fall back to the raw row.
 * Never fabricates a measure. Never fails the feature when the key is missing.
 */
export async function styleEcmRow(row: EcmLibraryRow): Promise<StyledEcm> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return unstyled(row);

  const model = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
  try {
    const client = new GoogleGenAI({ apiKey });
    const response = await client.models.generateContent({
      model,
      contents: [
        {
          role: "user",
          parts: [
            {
              text: `Rewrite the following Energy Conservation Measure library row as ONE readable sentence for an Indian energy auditor.

Absolute rules:
- Use only facts present in the row. Do not add equipment, numbers, savings, payback, sources, or claims that are not already in the row.
- Do not recommend anything that is not this row.
- Keep the ECM name, the description, the typical savings range if present, the payback if present, and the source reference.

ROW JSON:
${JSON.stringify({
  ecmName: row.ecmName,
  description: row.description,
  equipmentTag: row.equipmentTag,
  sectorOrCluster: row.sectorOrCluster,
  typicalSavingsRange: row.typicalSavingsRange,
  typicalPaybackMonths: row.typicalPaybackMonths,
  sourceReference: row.sourceReference,
})}

Return JSON: { "sentence": "..." }`,
            },
          ],
        },
      ],
      config: { temperature: 0, responseMimeType: "application/json" },
    });

    const raw = response.text ?? "";
    const parsed = JSON.parse(stripCodeFence(raw)) as { sentence?: string };
    if (parsed.sentence && styleIsGrounded(row, parsed.sentence)) {
      return {
        row,
        presentation: "styled",
        sentence: parsed.sentence,
        styled: true,
        generator: "gemini",
        model,
      };
    }
  } catch {
    // Model or network failure: the raw row is already a complete suggestion.
  }

  return unstyled(row);
}
