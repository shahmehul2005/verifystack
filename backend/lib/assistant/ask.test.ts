import { afterEach, describe, expect, it, vi } from "vitest";
import { knowledgeById } from "../../domain/assistant/knowledge";
import { askAssistant } from "./ask";

const OFF_TOPIC = [
  "What is the capital of France?",
  "Write me a poem about the ocean",
  "Explain quantum computing",
  "How do I bake a cake?",
];

describe("askAssistant", () => {
  const savedKey = process.env.GEMINI_API_KEY;
  afterEach(() => {
    if (savedKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = savedKey;
  });

  it.each(OFF_TOPIC)("refuses %s without spending model budget", async (q) => {
    process.env.GEMINI_API_KEY = "test-key";
    const allowModel = vi.fn(() => true);
    const reply = await askAssistant(q, [], { allowModel });
    expect(reply.outcome).toBe("out_of_scope");
    expect(allowModel).not.toHaveBeenCalled();
  });

  it("answers greetings without retrieval or a model", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    const allowModel = vi.fn(() => true);
    expect((await askAssistant("hi", [], { allowModel })).outcome).toBe("small_talk");
    expect(allowModel).not.toHaveBeenCalled();
  });

  it("answers from the library when no Gemini key is set", async () => {
    delete process.env.GEMINI_API_KEY;
    const allowModel = vi.fn(() => true);
    const reply = await askAssistant("What is VerifyStack?", [], { allowModel });
    expect(reply).toMatchObject({ outcome: "answered", mode: "library" });
    expect(reply.answer).toBe(knowledgeById("about")!.body);
    expect(allowModel).not.toHaveBeenCalled();
  });

  it("answers from the library when the model budget is spent", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    const allowModel = vi.fn(() => false);
    const reply = await askAssistant("Who signs off a verification?", [], { allowModel });
    expect(reply).toMatchObject({ outcome: "answered", mode: "library" });
    expect(allowModel).toHaveBeenCalledTimes(1);
  });

  it("uses the previous question for a short follow-up", async () => {
    delete process.env.GEMINI_API_KEY;
    const reply = await askAssistant(
      "tell me more",
      [
        { role: "user", content: "What is ADEETIE?" },
        { role: "assistant", content: "ADEETIE is a BEE scheme." },
      ],
      { allowModel: () => true }
    );
    expect(reply).toMatchObject({ outcome: "answered", sources: [{ id: "adeetie" }] });
  });
});
