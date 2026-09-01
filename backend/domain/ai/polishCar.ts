import "server-only";

/**
 * Optional Gemini polish for a CAR draft.
 *
 * The template in `draftCar.ts` is the product; this only rephrases it. The
 * polished text is accepted only when `polishIsGrounded` still finds the
 * finding's factual core in it, so a model that drops or invents a number is
 * discarded and the template stands.
 *
 * This lives in the domain layer rather than behind an HTTP route so that
 * authenticated callers reach it in-process. The route that wraps it exists for
 * the standalone workbench, and is separately authorised.
 */

import { GoogleGenAI } from "@google/genai";
import { draftCarFromTemplate, polishIsGrounded, type CarDraft } from "./draftCar";
import type { RuleFinding } from "../rules/types";

export interface PolishResult {
  draft: CarDraft;
  polished: boolean;
}

export async function polishCarDraft(finding: RuleFinding): Promise<PolishResult> {
  const template = draftCarFromTemplate(finding);
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { draft: template, polished: false };

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
              text: `Rewrite this corrective action request for an Indian GHG verifier. Do not add numbers, facts, or clause citations that are not already in the source. Keep every quantity and the clause reference. Tone: formal, short.

SOURCE TITLE: ${finding.title}
SOURCE DETAIL: ${finding.detail}
CLAUSE: ${finding.clauseRef}
TEMPLATE BODY: ${template.body}

Return JSON: { "body": "..." }`,
            },
          ],
        },
      ],
      config: { temperature: 0, responseMimeType: "application/json" },
    });

    const raw = response.text ?? "";
    const parsed = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, "")) as {
      body?: string;
    };
    if (parsed.body && polishIsGrounded(finding, parsed.body)) {
      return {
        draft: { ...template, body: parsed.body, generator: "gemini", model },
        polished: true,
      };
    }
  } catch {
    // A model or network failure is not a finding failure. The grounded
    // template is already a complete CAR.
  }

  return { draft: template, polished: false };
}
