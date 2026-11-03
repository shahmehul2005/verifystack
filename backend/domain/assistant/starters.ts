/**
 * The suggested questions shown when a visitor opens the assistant. Kept apart from
 * knowledge.ts so the client bundle does not carry the knowledge base. Each one must be
 * a clear match, which a test checks, so a suggestion is never refused.
 */
export const STARTER_QUESTIONS: readonly string[] = [
  "What is VerifyStack?",
  "How does an engagement work?",
  "Which schemes does it support?",
];
