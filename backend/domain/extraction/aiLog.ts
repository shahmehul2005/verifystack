/** Persist one AI action log row. Shared by the document, batch and route call sites. */

import type { createServiceClient } from "@verifystack/backend/lib/supabase/admin";
import type { AiActionLog } from "./provider";

export async function insertAiLog(
  admin: NonNullable<ReturnType<typeof createServiceClient>>,
  organizationId: string,
  log: AiActionLog
) {
  await admin.from("ai_action_logs").insert({
    organization_id: organizationId,
    tool: log.tool,
    provider: log.provider,
    model: log.model,
    prompt_version: log.promptVersion,
    input_hash: log.inputHash,
    evidence_id: log.evidenceId,
    page_number: log.pageNumber,
    started_at: log.startedAt,
    duration_ms: log.durationMs,
    raw_output: log.rawOutput,
    ok: log.ok,
    error: log.error ?? null,
  });
}
