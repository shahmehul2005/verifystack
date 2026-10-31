import { describe, expect, it } from "vitest";
import {
  NOT_COVERED_REPLY,
  OUT_OF_SCOPE_REPLY,
  assistantAnswerIsGrounded,
  parseAssistantOutput,
  resolveAssistantReply,
  smallTalkReply,
} from "./answer";
import { KNOWLEDGE } from "./knowledge";
import { isConfident, retrieveKnowledge, tokenize } from "./retrieve";
import { STARTER_QUESTIONS } from "./starters";

const OFF_TOPIC = [
  "What is the capital of France?",
  "Write me a poem about the ocean",
  "Who won the cricket world cup?",
  "What's the weather in Delhi today?",
  "Explain quantum computing",
  "Give me a recipe for biryani",
  "How do I bake a cake?",
  "Translate good morning into Spanish",
];

/** Pages the knowledge may link to. Each one exists on the site. */
const PAGES = new Set(["/", "/#schemes", "/#how-it-works", "/#demo", "/#capabilities", "/#trust", "/#faq", "/privacy", "/signup", "/login"]);

describe("assistant knowledge", () => {
  it("has unique ids and non-empty bodies", () => {
    const ids = KNOWLEDGE.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const e of KNOWLEDGE) {
      expect(e.body.length).toBeGreaterThan(40);
      expect(e.keywords.length).toBeGreaterThan(0);
    }
  });

  it("links only to same-site paths that exist", () => {
    for (const e of KNOWLEDGE) {
      if (e.href) {
        expect(e.href.startsWith("/")).toBe(true);
        expect(PAGES.has(e.href), e.href).toBe(true);
      }
    }
  });

  it("states no scheme threshold, factor value or unverified number", () => {
    for (const e of KNOWLEDGE) {
      expect(`${e.title} ${e.body}`, e.id).not.toMatch(/\b71\.7\b|\b0\.716\b|\b2 ?%|\b90 ?%|\b2 percent\b|\b90 percent\b/i);
    }
  });

  it("never describes a model as reading digital PDFs deterministically", () => {
    const extraction = KNOWLEDGE.find((e) => e.id === "extraction")!;
    expect(extraction.body).toMatch(/Gemini/);
    expect(extraction.body).not.toMatch(/parsed deterministically/i);
  });
});

describe("tokenize", () => {
  it("folds M&V and sign-off into single tokens", () => {
    expect(tokenize("What happens at M&V?")).toContain("mv");
    expect(tokenize("Who can sign off?")).toContain("signoff");
    expect(tokenize("How do I log in")).toContain("login");
  });

  it("drops stopwords", () => {
    expect(tokenize("what is the")).toEqual([]);
  });

  it("keeps help as a topic word, so 'what can you help with' is a question about the assistant", () => {
    expect(tokenize("What can you help with?")).toContain("help");
  });
});

describe("retrieveKnowledge", () => {
  it.each(STARTER_QUESTIONS)("answers the starter question %s", (q) => {
    expect(retrieveKnowledge(q).length).toBeGreaterThan(0);
  });

  it.each([
    ["What is VerifyStack?", "about"],
    ["Which schemes does it support?", "schemes"],
    ["How does an engagement work?", "how-it-works"],
    ["Who signs off a verification?", "signoff"],
    ["How do I invite my team?", "invites"],
    ["How do I request a demo?", "demo"],
    ["How much does it cost?", "pricing"],
    ["What happens in the M&V phase?", "adeetie-phases"],
    ["I forgot my password", "sign-in"],
  ])("ranks %s to %s first", (q, id) => {
    expect(retrieveKnowledge(q)[0]?.entry.id).toBe(id);
  });

  it.each(OFF_TOPIC)("finds nothing for the off-topic question %s", (q) => {
    expect(retrieveKnowledge(q)).toEqual([]);
  });

  it("returns at most four entries", () => {
    expect(retrieveKnowledge("ccts adeetie gei sec packs findings sign-off reports").length).toBeLessThanOrEqual(4);
  });
});

describe("topical coverage", () => {
  it("is confident about a clear product question", () => {
    expect(isConfident(retrieveKnowledge("What is VerifyStack?"))).toBe(true);
    expect(isConfident(retrieveKnowledge("Does the AI calculate anything?"))).toBe(true);
  });

  it("is not confident about a loose match, though something is retrieved", () => {
    const loose = retrieveKnowledge("I'm bored, what's the best phone?");
    expect(loose.length).toBeGreaterThan(0);
    expect(isConfident(loose)).toBe(false);
    expect(isConfident(retrieveKnowledge("Write a poem about carbon"))).toBe(false);
  });

  it.each(STARTER_QUESTIONS)("treats the starter %s as a confident question", (q) => {
    expect(isConfident(retrieveKnowledge(q))).toBe(true);
  });
});

describe("current product knowledge routes to the right entry", () => {
  it.each([
    ["What is a desk review?", "desk-review"],
    ["How do I record a decision on a check?", "desk-decisions"],
    ["What does the evidence checklist require?", "evidence-checklist"],
    ["How do I use the sector pro forma?", "proforma-inputs"],
    ["What is calculation readiness?", "calculation-readiness"],
    ["Why is a calculation blocked?", "calculation-readiness"],
    ["What is the review queue?", "review-queue"],
    ["How are savings calculated in the DPR?", "adeetie-savings"],
    ["How do I create an engagement?", "new-engagement"],
    ["Can I talk to a person?", "support"],
    ["Does it support CBAM?", "not-available"],
    ["What topics can you help with?", "topics"],
    ["What is the ECM library?", "ecm"],
    ["Is my data used for training?", "privacy"],
    ["How do I suggest document types?", "document-types"],
    ["Who signs off a verification?", "signoff"],
  ])("ranks %s to %s first", (q, id) => {
    expect(retrieveKnowledge(q)[0]?.entry.id).toBe(id);
  });
});

describe("smallTalkReply", () => {
  it("handles greetings and thanks without retrieval", () => {
    expect(smallTalkReply("Hello!")?.outcome).toBe("small_talk");
    expect(smallTalkReply("thanks a lot")?.outcome).toBe("small_talk");
    expect(smallTalkReply("hello, what is CCTS?")).toBeNull();
  });
});

describe("assistant groundedness gate", () => {
  const retrieved = retrieveKnowledge("Which schemes does it support?");

  it("accepts an answer that cites retrieved entries", () => {
    const out = {
      status: "answered" as const,
      answer: "VerifyStack supports CCTS and ADEETIE.",
      sources: [retrieved[0]!.entry.id],
    };
    expect(assistantAnswerIsGrounded(out, retrieved).ok).toBe(true);
    const reply = resolveAssistantReply(out, retrieved);
    expect(reply.mode).toBe("model");
    expect(reply.answer).toBe(out.answer);
  });

  it("rejects a source outside the retrieved set and shows the library entry", () => {
    const out = { status: "answered" as const, answer: "Yes.", sources: ["pricing"] };
    expect(assistantAnswerIsGrounded(out, retrieved).ok).toBe(false);
    const reply = resolveAssistantReply(out, retrieved);
    expect(reply.mode).toBe("library");
    expect(reply.answer).toBe(retrieved[0]!.entry.body);
  });

  it("rejects numbers that are not in the cited entries", () => {
    const out = {
      status: "answered" as const,
      answer: "VerifyStack supports 12 schemes with 40% subvention.",
      sources: [retrieved[0]!.entry.id],
    };
    const gate = assistantAnswerIsGrounded(out, retrieved);
    expect(gate.ok).toBe(false);
    expect(gate.reason).toContain("12");
  });

  it("allows numbers that are in the cited entry", () => {
    const packs = retrieveKnowledge("How many sectors do the methodology packs cover?");
    expect(packs.map((r) => r.entry.id)).toContain("packs");
    const out = {
      status: "answered" as const,
      answer: "There are CCTS packs for 9 sectors and ADEETIE packs for 14 sectors.",
      sources: ["packs"],
    };
    expect(assistantAnswerIsGrounded(out, packs).ok).toBe(true);
  });

  it("rejects an answer whose words do not come from the cited entries", () => {
    const id = retrieved[0]!.entry.id;
    const poem = "The ocean is wide and blue, and the sky is endless above the shore.";
    expect(assistantAnswerIsGrounded({ status: "answered", answer: poem, sources: [id] }, retrieved).ok).toBe(false);
  });

  it("rejects text about the assistant's own instructions", () => {
    const id = retrieved[0]!.entry.id;
    const out = { status: "answered" as const, answer: "My instructions say to keep this short about VerifyStack and its schemes.", sources: [id] };
    const gate = assistantAnswerIsGrounded(out, retrieved);
    expect(gate.ok).toBe(false);
    expect(gate.reason).toMatch(/own instructions/);
  });

  it("rejects links and empty or uncited answers", () => {
    const id = retrieved[0]!.entry.id;
    expect(assistantAnswerIsGrounded({ status: "answered", answer: "See https://example.com", sources: [id] }, retrieved).ok).toBe(false);
    expect(assistantAnswerIsGrounded({ status: "answered", answer: "  ", sources: [id] }, retrieved).ok).toBe(false);
    expect(assistantAnswerIsGrounded({ status: "answered", answer: "CCTS.", sources: [] }, retrieved).ok).toBe(false);
  });

  it("turns model refusals into fixed replies", () => {
    expect(resolveAssistantReply({ status: "out_of_scope", answer: "", sources: [] }, retrieved).answer).toBe(OUT_OF_SCOPE_REPLY);
    const notCovered = resolveAssistantReply({ status: "not_covered", answer: "", sources: [] }, retrieved);
    expect(notCovered.answer).toBe(NOT_COVERED_REPLY);
    expect(notCovered.sources).toEqual([expect.objectContaining({ id: "demo", href: "/#demo" })]);
  });

  it("falls back to the library entry when the output does not parse", () => {
    expect(parseAssistantOutput("not json")).toBeNull();
    expect(parseAssistantOutput('```json\n{"status":"answered","answer":"x","sources":["about"]}\n```')?.status).toBe("answered");
    expect(resolveAssistantReply(null, retrieved).mode).toBe("library");
  });
});

describe("DFD v3.1 knowledge", () => {
  it.each([
    ["Can I upload an Excel file or SCADA export?", "evidence-types"],
    ["What is the submission package?", "submission-package"],
    ["How does the entity respond to an issue?", "issues"],
    ["What is a technical review?", "technical-review"],
    ["How do I schedule a site visit and record observations offline?", "fieldwork"],
    ["Can I import many engagements from a spreadsheet?", "import-stages"],
  ])("ranks %s to %s first", (q, id) => {
    expect(retrieveKnowledge(q)[0]?.entry.id).toBe(id);
  });
});
