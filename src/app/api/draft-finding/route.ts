import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { draftCarFromTemplate, polishIsGrounded } from "@/domain/ai/draftCar";
import type { RuleFinding } from "@/domain/rules/types";

const Finding = z.object({
  ruleId: z.string(),
  severity: z.enum(["block", "warn", "info"]),
  title: z.string(),
  detail: z.string(),
  clauseRef: z.string(),
  evidenceRefs: z.array(z.string()),
  magnitude: z
    .object({ value: z.number(), unit: z.string() })
    .optional(),
});

export async function POST(req: Request) {
  const body = Finding.safeParse(await req.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json({ ok: false, error: "Invalid finding" }, { status: 400 });
  }

  const finding = body.data as RuleFinding;
  const template = draftCarFromTemplate(finding);
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return NextResponse.json({ ok: true, draft: template, polished: false });
  }

  try {
    const client = new GoogleGenAI({ apiKey });
    const model = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
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
      return NextResponse.json({
        ok: true,
        draft: {
          ...template,
          body: parsed.body,
          generator: "gemini",
          model,
        },
        polished: true,
      });
    }
  } catch {
    /* fall through to template */
  }

  return NextResponse.json({ ok: true, draft: template, polished: false });
}
