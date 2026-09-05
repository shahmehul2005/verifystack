/**
 * Attach a retrieved, grounded citation to a RuleFinding.
 *
 * Called immediately before CAR language is drafted. The LLM sees only
 * retrieved chunk text. If the gate rejects, the finding is stored with no
 * citation and an explicit reason — never a fabricated clause.
 */

import "server-only";
import type { RuleFinding } from "../rules/types";
import { embedText } from "./embed";
import { draftCitationFromChunks } from "./generate";
import { citationIsGrounded, pickGroundedChunk } from "./groundedness";
import { retrieveFromDb } from "./retrieve";
import {
  CitationError,
  EmbeddingError,
  NO_APPLICABLE_CLAUSE,
  emptyCitationColumns,
  groundedCitationColumns,
  type CitationAttachment,
  type CiteDeps,
  type PackFilter,
} from "./types";

export function queryTextForFinding(finding: RuleFinding): string {
  return [finding.ruleId, finding.title, finding.detail, finding.clauseRef]
    .filter(Boolean)
    .join("\n");
}

export function createDefaultCiteDeps(supabase: Parameters<typeof retrieveFromDb>[0]): CiteDeps {
  return {
    embed: (text, task) => embedText(text, task),
    retrieve: (queryEmbedding, filter) => retrieveFromDb(supabase, queryEmbedding, filter),
    draft: (title, detail, chunks) => draftCitationFromChunks(title, detail, chunks),
  };
}

async function citeUnchecked(
  finding: RuleFinding,
  filter: PackFilter,
  deps: CiteDeps
): Promise<CitationAttachment> {
  const queryEmbedding = await deps.embed(queryTextForFinding(finding), "RETRIEVAL_QUERY");
  const retrieved = await deps.retrieve(queryEmbedding, filter);

  if (retrieved.length === 0) {
    return {
      kind: "no_applicable_clause",
      state: "none",
      gate: "no_applicable_clause",
      columns: emptyCitationColumns("no_applicable_clause", NO_APPLICABLE_CLAUSE),
    };
  }

  const output = await deps.draft(finding.title, finding.detail, retrieved);
  const gate = citationIsGrounded(output, retrieved);

  if (!gate.ok) {
    return {
      kind: "rejected",
      state: "none",
      gate: "rejected",
      reason: gate.reason,
      columns: emptyCitationColumns(
        "rejected",
        `Citation rejected: ${gate.reason}. Routed to human review with no citation attached.`
      ),
    };
  }

  if (!gate.applicable) {
    return {
      kind: "no_applicable_clause",
      state: "none",
      gate: "no_applicable_clause",
      columns: emptyCitationColumns("no_applicable_clause", NO_APPLICABLE_CLAUSE),
    };
  }

  const picked = pickGroundedChunk(output, retrieved);
  if (!picked) {
    return {
      kind: "rejected",
      state: "none",
      gate: "rejected",
      reason: "Grounded output had no matching chunk",
      columns: emptyCitationColumns(
        "rejected",
        "Citation rejected: grounded output had no matching chunk. Routed to human review with no citation attached."
      ),
    };
  }

  return {
    kind: "grounded",
    state: "suggested",
    gate: "grounded",
    chunk: picked.chunk,
    explanation: picked.explanation,
    columns: groundedCitationColumns(picked.chunk, picked.explanation),
  };
}

export async function citeFinding(
  finding: RuleFinding,
  filter: PackFilter,
  deps: CiteDeps
): Promise<CitationAttachment> {
  try {
    return await citeUnchecked(finding, filter, deps);
  } catch (err) {
    if (err instanceof EmbeddingError || err instanceof CitationError) {
      return {
        kind: "unavailable",
        state: "none",
        gate: "unavailable",
        reason: err.message,
        columns: emptyCitationColumns("unavailable", err.message),
      };
    }
    throw err;
  }
}
