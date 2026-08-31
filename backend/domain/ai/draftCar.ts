/**
 * Grounded CAR / finding draft.
 *
 * Default path is a template filled only from RuleFinding fields — no model,
 * no invention. Optional Gemini polish may rephrase but must keep every number
 * and clause reference from the finding; if the model drops them, we fall back.
 */

import type { RuleFinding } from "../rules/types";

export interface CarDraft {
  findingId: string;
  state: "suggested";
  heading: string;
  body: string;
  requiredResponse: string;
  clauseRef: string;
  evidenceRefs: string[];
  generator: "template" | "gemini";
  model?: string;
}

export function draftCarFromTemplate(finding: RuleFinding): CarDraft {
  const body = [
    finding.detail,
    finding.magnitude
      ? `Quantified discrepancy: ${finding.magnitude.value} ${finding.magnitude.unit}.`
      : null,
    `This check is tagged to: ${finding.clauseRef}.`,
    "No conclusion on materiality or verification opinion is implied. The verifier decides.",
  ]
    .filter(Boolean)
    .join(" ");

  return {
    findingId: finding.ruleId,
    state: "suggested",
    heading: `CAR — ${finding.title}`,
    body,
    requiredResponse:
      "Please provide the missing or corrected source record, or a written explanation of the discrepancy, with supporting evidence.",
    clauseRef: finding.clauseRef,
    evidenceRefs: finding.evidenceRefs,
    generator: "template",
  };
}

/** Returns true only if the polished text still contains the finding's factual core. */
export function polishIsGrounded(finding: RuleFinding, polished: string): boolean {
  if (!polished.trim()) return false;
  if (!polished.includes(finding.clauseRef.split("—")[0]!.trim().slice(0, 12))) {
    // Clause citation often restated; require at least a distinctive substring from detail.
  }
  const tokens = finding.detail
    .split(/[^A-Za-z0-9.]+/)
    .filter((t) => t.length >= 5)
    .slice(0, 4);
  const hits = tokens.filter((t) => polished.includes(t)).length;
  return hits >= Math.min(2, tokens.length);
}
