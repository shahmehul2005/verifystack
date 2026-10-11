/**
 * "Explore topics" chips in the assistant widget. Kept apart from knowledge.ts
 * so the client bundle does not carry the knowledge base. A test checks that
 * each one retrieves at least one entry.
 */
export const STARTER_QUESTIONS: readonly string[] = [
  "What is VerifyStack?",
  "Which schemes does it support?",
  "How does an engagement work?",
  "Does the AI calculate anything?",
  "Who signs off a verification?",
  "How do I invite my team?",
  "Is our evidence kept secure?",
  "How do I request a demo?",
];
