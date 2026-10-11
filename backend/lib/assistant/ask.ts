import "server-only";
import { GoogleGenAI } from "@google/genai";
import {
  ASSISTANT_SYSTEM_INSTRUCTION,
  buildAssistantPrompt,
  libraryReply,
  outOfScopeReply,
  parseAssistantOutput,
  resolveAssistantReply,
  smallTalkReply,
  type AssistantReply,
  type ChatTurn,
} from "@verifystack/backend/domain/assistant/answer";
import { retrieveKnowledge } from "@verifystack/backend/domain/assistant/retrieve";

export interface AskOptions {
  /**
   * Called once, only when a model call would happen; it may spend budget.
   * False means answer from the library without calling the model.
   */
  allowModel: () => boolean;
}

/**
 * Retrieval runs first and decides scope. The model is called only when at
 * least one knowledge entry matched, and only to rephrase those entries.
 */
export async function askAssistant(
  question: string,
  history: ChatTurn[],
  { allowModel }: AskOptions
): Promise<AssistantReply> {
  const smallTalk = smallTalkReply(question);
  if (smallTalk) return smallTalk;

  let retrieved = retrieveKnowledge(question);
  if (retrieved.length === 0) {
    const previous = [...history].reverse().find((t) => t.role === "user");
    if (previous) retrieved = retrieveKnowledge(`${previous.content} ${question}`);
  }
  if (retrieved.length === 0) return outOfScopeReply();

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || !allowModel()) return libraryReply(retrieved);

  try {
    const client = new GoogleGenAI({ apiKey });
    const response = await client.models.generateContent({
      model: process.env.GEMINI_MODEL ?? "gemini-2.5-flash",
      contents: [
        { role: "user", parts: [{ text: buildAssistantPrompt(question, history, retrieved) }] },
      ],
      config: {
        temperature: 0,
        responseMimeType: "application/json",
        systemInstruction: ASSISTANT_SYSTEM_INSTRUCTION,
      },
    });
    return resolveAssistantReply(parseAssistantOutput(response.text ?? ""), retrieved);
  } catch (err) {
    console.error("[assistant] model call failed", err instanceof Error ? err.message : err);
    return libraryReply(retrieved);
  }
}
