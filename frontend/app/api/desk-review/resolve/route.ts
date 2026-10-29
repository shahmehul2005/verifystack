import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability, assertOrgId } from "@verifystack/backend/lib/auth/requireRole";
import { jsonError } from "@/lib/api";
import { createServiceClient } from "@verifystack/backend/lib/supabase/admin";
import { auditEvent } from "@verifystack/backend/lib/auth/auditEvent";
import { displayNameOf } from "@verifystack/backend/lib/auth/displayName";
import { getEngagement, ensureEngagementStatus } from "@verifystack/backend/lib/data/engagements";
import type { DeskOutcome } from "@verifystack/backend/domain/deskreview/engine";
import {
  DECIDABLE_STATES,
  planDeskResolution,
  ResolutionError,
} from "@verifystack/backend/domain/deskreview/resolution";
import { BLOCK_IDS, deskFindingDraft } from "@verifystack/backend/domain/deskreview/toFindings";
import { isBlockingOpen, type IssueSeverity, type IssueState } from "@verifystack/backend/domain/issues/lifecycle";
import type { FindingState, Json } from "@verifystack/backend/lib/supabase/types";

export const runtime = "nodejs";

const Body = z.object({
  engagementId: z.string().uuid(),
  ruleId: z.string().min(1).max(120),
  state: z.enum(DECIDABLE_STATES as [string, ...string[]]),
  reason: z.string().trim().min(1).max(4000),
});

/**
 * The verifier's decision on one desk-review check. The check's own status comes
 * from the latest saved run, not from the request, so a decision cannot be filed
 * against a check that agrees. The decision is applied to the linked finding with
 * the same lifecycle the Findings page uses; nothing here skips a step.
 */
export async function POST(req: Request) {
  try {
    await requireCapability("review.decide");
    const session = await requireCapability("findings.decide");
    const organizationId = assertOrgId(session.organizationId);
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ ok: false, error: "Invalid body" }, { status: 400 });
    const { engagementId, ruleId } = parsed.data;
    const state = parsed.data.state as (typeof DECIDABLE_STATES)[number];
    const reason = parsed.data.reason;

    const engagement = await getEngagement(engagementId, organizationId);
    if (!engagement) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    const supabase = createServiceClient();
    if (!supabase) return NextResponse.json({ ok: false, error: "Supabase is not configured" }, { status: 503 });

    const { data: review, error: reviewError } = await supabase
      .from("desk_reviews")
      .select("results")
      .eq("engagement_id", engagementId)
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (reviewError) throw new Error(reviewError.message);
    const outcome = ((review?.results ?? []) as unknown as DeskOutcome[]).find((r) => r.id === ruleId);
    if (!outcome) {
      return NextResponse.json({ ok: false, error: "That check is not in the latest desk review. Run the review first." }, { status: 404 });
    }

    const findingRule = `DESK-${ruleId}`;
    const { data: found, error: findError } = await supabase
      .from("findings")
      .select("id, severity, state")
      .eq("engagement_id", engagementId)
      .eq("organization_id", organizationId)
      .eq("rule_id", findingRule)
      .maybeSingle();
    if (findError) throw new Error(findError.message);

    const inherentBlock = BLOCK_IDS.has(ruleId);
    const plan = planDeskResolution({
      state,
      reason,
      checkStatus: outcome.status,
      finding: found ? { severity: found.severity as IssueSeverity, state: found.state as IssueState } : null,
      inherentBlock,
    });

    // The plan passed, so a finding may now be raised for a check that has none (a check waiting for readings, for instance).
    let findingId = found?.id ?? null;
    let currentState = (found?.state ?? "suggested") as FindingState;
    let currentSeverity = (found?.severity ?? null) as IssueSeverity | null;
    if (!findingId) {
      const draft = deskFindingDraft(outcome);
      const { data: created, error: createError } = await supabase
        .from("findings")
        .insert({
          organization_id: organizationId,
          engagement_id: engagementId,
          calculation_run_id: null,
          rule_id: draft.ruleId,
          severity: draft.severity,
          title: draft.title,
          detail: draft.detail,
          clause_ref: draft.clauseRef,
          evidence_refs: draft.evidenceRefs as unknown as Json,
          state: "suggested" as const,
        })
        .select("id, severity, state")
        .single();
      if (createError || !created) throw new Error(createError?.message ?? "Could not raise the finding");
      findingId = created.id;
      currentState = created.state as FindingState;
      currentSeverity = created.severity as IssueSeverity;
    }

    const now = new Date().toISOString();
    const finalState = (plan.path[plan.path.length - 1] ?? currentState) as FindingState;
    const severityChanged = currentSeverity !== plan.severity;
    if (plan.path.length > 0 || severityChanged) {
      const updates: {
        updated_at: string;
        state?: FindingState;
        severity?: IssueSeverity;
        opened_at?: string;
        due_at?: string;
        responded_at?: string;
        verified_at?: string;
        response_nonce?: string | null;
      } = { updated_at: now };
      if (severityChanged) updates.severity = plan.severity;
      if (plan.path.length > 0) {
        updates.state = finalState;
        if (plan.path.includes("open")) {
          updates.opened_at = now;
          updates.due_at = now;
        }
        if (plan.path.includes("responded")) updates.responded_at = now;
        if (plan.path.includes("verified")) updates.verified_at = now;
        // No entity link is minted: the verifier is recording the explanation, not asking the plant.
        updates.response_nonce = null;
      }
      // The state guard stops two people moving the same finding at once.
      const { data: written, error: writeError } = await supabase
        .from("findings")
        .update(updates)
        .eq("id", findingId)
        .eq("organization_id", organizationId)
        .eq("state", currentState)
        .select("id");
      if (writeError) throw new Error(writeError.message);
      if (!written || written.length === 0) {
        return NextResponse.json({ ok: false, error: "Someone else changed this finding. Reload and try again." }, { status: 409 });
      }
    }

    if (plan.recordExplanation) {
      const { error: responseError } = await supabase.from("issue_responses").insert({
        organization_id: organizationId,
        engagement_id: engagementId,
        finding_id: findingId,
        kind: "verifier",
        responder_name: displayNameOf(session.user),
        body: reason,
        recorded_by: session.user.id,
      });
      if (responseError) throw new Error(responseError.message);
    }

    const { error: resolutionError } = await supabase.from("desk_resolutions").upsert(
      {
        organization_id: organizationId,
        engagement_id: engagementId,
        rule_id: ruleId,
        resolution_state: state,
        reason,
        finding_id: findingId,
        decided_by: session.user.id,
        decided_at: now,
      },
      { onConflict: "engagement_id,rule_id" }
    );
    if (resolutionError) {
      if (/desk_resolutions/.test(resolutionError.message)) {
        throw new ResolutionError("Migration 0019 has not been applied to this Supabase project, so decisions cannot be saved yet.");
      }
      throw new Error(resolutionError.message);
    }

    await auditEvent({
      organizationId,
      actorUserId: session.user.id,
      action: "desk_review.resolve",
      entityType: "finding",
      entityId: findingId,
      payload: {
        ruleId,
        resolution: state,
        checkStatus: outcome.status,
        severity: plan.severity,
        ...(plan.path.length ? { path: plan.path } : {}),
        actor: displayNameOf(session.user),
      },
    });

    // Closing the last blocking finding moves the engagement on, as it does from the Findings page.
    if (finalState === "closed") {
      const { data: remaining } = await supabase
        .from("findings")
        .select("id, severity, state")
        .eq("engagement_id", engagementId)
        .eq("organization_id", organizationId);
      const openBlocks = (remaining ?? []).filter((f) => isBlockingOpen({ severity: f.severity, state: f.state as IssueState }));
      if (openBlocks.length === 0) {
        await ensureEngagementStatus({
          organizationId,
          actorUserId: session.user.id,
          engagementId: engagement.id,
          current: engagement.status,
          target: "signoff",
        });
      }
    }

    return NextResponse.json({ ok: true, findingId, resolution: state, blocksSignOff: plan.blocksSignOff });
  } catch (e) {
    return jsonError(e);
  }
}
