import { NextResponse } from "next/server";
import { z } from "zod";
import {
  MAX_HISTORY_TURNS,
  MAX_QUESTION_CHARS,
} from "@verifystack/backend/domain/assistant/answer";
import { askAssistant } from "@verifystack/backend/lib/assistant/ask";
import { LIMITS, rateLimit } from "@verifystack/backend/lib/rateLimit";
import { clientIp, limitExceeded } from "@/lib/api";

const Body = z.object({
  question: z.string().trim().min(1).max(MAX_QUESTION_CHARS),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(2000),
      })
    )
    .max(20)
    .default([]),
});

/**
 * Public website assistant. Stores nothing and reads no tenant data. Each
 * message is screened for injected instructions and personal or secret details
 * before anything else; then answers come only from the curated knowledge in
 * backend/domain/assistant, and a model may only rephrase a matched entry.
 */
export async function POST(req: Request) {
  const limited = limitExceeded(`assistant:ip:${clientIp(req)}`, LIMITS.assistantPerIp);
  if (limited) return limited;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: `Ask a question of up to ${MAX_QUESTION_CHARS} characters.` },
      { status: 400 }
    );
  }

  const { question, history } = parsed.data;
  const reply = await askAssistant(question, history.slice(-MAX_HISTORY_TURNS), {
    allowModel: () => {
      const { limit, windowMs } = LIMITS.assistantModelBudget;
      return rateLimit("assistant:model-budget", limit, windowMs).ok;
    },
  });

  // The outcome and the mode only. The question and the answer are never logged.
  console.info("[assistant] outcome", reply.outcome, reply.mode);
  const res = NextResponse.json({ ok: true, ...reply });
  res.headers.set("Cache-Control", "no-store");
  return res;
}
