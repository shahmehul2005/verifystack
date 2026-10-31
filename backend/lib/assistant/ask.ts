import "server-only";
import { GoogleGenAI } from "@google/genai";
import {
  ASSISTANT_SYSTEM_INSTRUCTION,
  buildAssistantPrompt,
  libraryReply,
  outOfScopeReply,
  parseAssistantOutput,
  refusedReply,
  resolveAssistantReply,
  smallTalkReply,
  type AssistantReply,
  type ChatTurn,
} from "@verifystack/backend/domain/assistant/answer";
import { screenVisitorText } from "@verifystack/backend/domain/assistant/guard";
import { isConfident, retrieveKnowledge, tokenize } from "@verifystack/backend/domain/assistant/retrieve";

export interface AskOptions {
  /**
   * Called once, only when a model call would happen; it may spend budget.
   * False means answer from the library without calling the model.
   */
  allowModel: () => boolean;
}

/**
 * A visitor should not wait on a busy model. One attempt, bounded in time: if the model does
 * not answer within this, the reply comes from the matched entry, or the question is refused.
 * The SDK's default is five attempts with backoff, which can keep a visitor waiting a minute.
 */
const MODEL_TIMEOUT_MS = 15_000;

/**
 * The order is the guardrail. Screening runs first, so a refused message is never
 * retrieved or sent to a model. Retrieval decides scope. A clear match may be answered
 * from the library; a loose match is answered only if the model cites it and the
 * answer passes the gate, and is otherwise refused.
 */
export async function askAssistant(
  question: string,
  history: ChatTurn[],
  { allowModel }: AskOptions
): Promise<AssistantReply> {
  const screened = screenVisitorText(question);
  if (!screened.ok) return refusedReply(screened.reason);
  const text = screened.text;

  const smallTalk = smallTalkReply(text);
  if (smallTalk) return smallTalk;

  const turns = screenHistory(history);
  let retrieved = retrieveKnowledge(text);
  if (retrieved.length === 0 && tokenize(text).length === 0) {
    // "tell me more" or "why?" has no words of its own. It takes its meaning from the last question.
    // A question with its own words is judged alone, so an off-topic request cannot borrow the product topic.
    const previous = [...turns].reverse().find((t) => t.role === "user");
    if (previous) retrieved = retrieveKnowledge(previous.content);
  }
  if (retrieved.length === 0) return outOfScopeReply();

  const confident = isConfident(retrieved);
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || !allowModel()) return confident ? libraryReply(retrieved) : outOfScopeReply();

  try {
    const client = new GoogleGenAI({
      apiKey,
      httpOptions: { timeout: MODEL_TIMEOUT_MS, retryOptions: { attempts: 1 } },
    });
    const response = await client.models.generateContent({
      model: process.env.GEMINI_MODEL ?? "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: buildAssistantPrompt(text, turns, retrieved) }] }],
      config: {
        temperature: 0,
        responseMimeType: "application/json",
        systemInstruction: ASSISTANT_SYSTEM_INSTRUCTION,
      },
    });
    const reply = resolveAssistantReply(parseAssistantOutput(response.text ?? ""), retrieved);
    // A loose match is shown only when the model answered from it, and the answer passed the gate.
    if (reply.mode === "library" && !confident) return outOfScopeReply();
    return reply;
  } catch (err) {
    console.error("[assistant] model call failed", err instanceof Error ? err.message : err);
    return confident ? libraryReply(retrieved) : outOfScopeReply();
  }
}

/** Earlier visitor turns are screened too. A turn that would have been refused is dropped, not sent on. */
function screenHistory(history: ChatTurn[]): ChatTurn[] {
  return history.flatMap((turn) => {
    if (turn.role === "assistant") return [turn];
    const screened = screenVisitorText(turn.content);
    return screened.ok ? [{ role: turn.role, content: screened.text }] : [];
  });
}
