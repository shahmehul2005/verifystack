import type { DeskOutcome } from "./engine";

export interface SiteVisitQuestion {
  id: string;
  question: string;
}

/** One question per failed desk-review check, for the site team to ask. */
export function siteVisitQuestions(outcomes: DeskOutcome[]): SiteVisitQuestion[] {
  return outcomes
    .filter((outcome) => outcome.status === "fail")
    .map((outcome) => ({
      id: outcome.id,
      question: `Ask the plant to explain: ${outcome.label}. ${outcome.detail}`,
    }));
}
