import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability, assertOrgId } from "@verifystack/backend/lib/auth/requireRole";
import { appOrigin, jsonError, limitExceeded } from "@/lib/api";
import { LIMITS } from "@verifystack/backend/lib/rateLimit";
import { createServerSupabase } from "@verifystack/backend/lib/supabase/server";
import { createServiceClient } from "@verifystack/backend/lib/supabase/admin";
import { getEngagement, ensureEngagementStatus } from "@verifystack/backend/lib/data/engagements";
import { auditEvent } from "@verifystack/backend/lib/auth/auditEvent";
import { displayNameOf } from "@verifystack/backend/lib/auth/displayName";
import {
  RESPONSE_LINK_TTL_MS,
  newResponseNonce,
  responseLinkPath,
  signResponseLink,
} from "@verifystack/backend/lib/auth/responseLink";
import { polishCarDraft } from "@verifystack/backend/domain/ai/polishCar";
import {
  IssueTransitionError,
  assertTransition,
  defaultDueDate,
  isBlockingOpen,
  type IssueSeverity,
  type IssueState,
} from "@verifystack/backend/domain/issues/lifecycle";
import type { RuleFinding } from "@verifystack/backend/domain/rules/types";
import type { FindingState } from "@verifystack/backend/lib/supabase/types";

const STATES = [
  "suggested",
  "accepted",
  "edited",
  "rejected",
  "open",
  "responded",
  "verified",
  "closed",
] as const;

const PatchBody = z.object({
  engagementId: z.string().uuid(),
  findingId: z.string().uuid(),
  state: z.enum(STATES).optional(),
  /** When opening or re-opening with the entity. Defaults to the firm's response period. */
  dueAt: z.string().max(40).optional(),
  /** `newLink` replaces the response link, `revokeLink` kills it, `recordResponse` logs one received off-platform. */
  action: z.enum(["newLink", "revokeLink", "recordResponse"]).optional(),
  responseBody: z.string().trim().min(5).max(8000).optional(),
  responderName: z.string().trim().min(2).max(200).optional(),
  polish: z.boolean().optional(),
  citationState: z.enum(["suggested", "accepted", "edited", "rejected"]).optional(),
  citationExplanation: z.string().max(8000).optional(),
});

export async function PATCH(req: Request) {
  return handle(req);
}

export async function POST(req: Request) {
  return handle(req);
}

/**
 * A draft that is not yet accepted may be opened or closed in one click, which
 * is two steps in the lifecycle. Both are checked before either is written, so a
 * block issue that must not close fails cleanly instead of half-moving.
 */
function planPath(from: IssueState, to: IssueState, severity: IssueSeverity): IssueState[] {
  try {
    assertTransition(from, to, severity);
    return [to];
  } catch (direct) {
    if (from === "suggested" && (to === "closed" || to === "open")) {
      assertTransition("suggested", "accepted", severity);
      assertTransition("accepted", to, severity);
      return ["accepted", to];
    }
    throw direct;
  }
}

async function handle(req: Request) {
  try {
    const session = await requireCapability("findings.decide");
    const organizationId = assertOrgId(session.organizationId);
    const parsed = PatchBody.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: "Invalid body" }, { status: 400 });
    }
    const body = parsed.data;
    const supabase = createServiceClient() ?? (await createServerSupabase());
    if (!supabase) {
      return NextResponse.json({ ok: false, error: "Supabase is not configured" }, { status: 503 });
    }
    const { data: finding } = await supabase
      .from("findings")
      .select("*")
      .eq("id", body.findingId)
      .eq("organization_id", organizationId)
      .eq("engagement_id", body.engagementId)
      .single();
    if (!finding) {
      return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    }
    const severity = finding.severity as IssueSeverity;
    const current = finding.state as IssueState;

    if (body.polish) {
      const limited = limitExceeded(`model:${session.user.id}`, LIMITS.modelCallsPerUser);
      if (limited) return limited;
    }

    const now = new Date();
    let polished = false;
    let responseLink: string | null = null;
    const updates: {
      updated_at: string;
      body?: string;
      heading?: string;
      generator?: string;
      state?: FindingState;
      due_at?: string | null;
      opened_at?: string | null;
      responded_at?: string | null;
      verified_at?: string | null;
      response_nonce?: string | null;
      citation_state?: "suggested" | "accepted" | "edited" | "rejected";
      citation_explanation?: string;
    } = { updated_at: now.toISOString() };

    /** Mint a link bound to a fresh nonce; the previous link stops working. */
    const mintLink = (due: Date): void => {
      const nonce = newResponseNonce();
      updates.response_nonce = nonce;
      const exp = Math.max(now.getTime() + RESPONSE_LINK_TTL_MS, due.getTime() + 7 * 86_400_000);
      const token = signResponseLink({
        findingId: finding.id,
        engagementId: finding.engagement_id,
        organizationId,
        nonce,
        exp,
      });
      responseLink = `${appOrigin(req)}${responseLinkPath(token)}`;
    };

    if (body.polish) {
      const ruleFinding: RuleFinding = {
        ruleId: finding.rule_id,
        severity: finding.severity,
        title: finding.title,
        detail: finding.detail,
        clauseRef: finding.clause_ref,
        evidenceRefs: (finding.evidence_refs as string[]) ?? [],
        magnitude: finding.magnitude as RuleFinding["magnitude"],
      };
      const drafted = await polishCarDraft(ruleFinding);
      updates.body = drafted.draft.body;
      updates.heading = drafted.draft.heading;
      updates.generator = drafted.draft.generator;
      polished = drafted.polished;
    }

    let path: IssueState[] = [];
    let recordedResponseId: string | null = null;

    if (body.action === "newLink") {
      if (current !== "open") throw new IssueTransitionError("A response link can only be issued while the issue is open with the entity.");
      mintLink(finding.due_at ? new Date(finding.due_at) : defaultDueDate(now));
    } else if (body.action === "revokeLink") {
      if (current !== "open") throw new IssueTransitionError("There is no live response link on this issue.");
      updates.response_nonce = null;
    } else if (body.action === "recordResponse") {
      if (current !== "open") throw new IssueTransitionError("A response can only be recorded while the issue is open with the entity.");
      if (!body.responseBody) {
        return NextResponse.json({ ok: false, error: "Write down the response you received." }, { status: 400 });
      }
      assertTransition("open", "responded", severity);
      path = ["responded"];
      updates.responded_at = now.toISOString();
      updates.response_nonce = null;
    } else if (body.state) {
      path = planPath(current, body.state, severity);
      const goal = path[path.length - 1]!;
      if (goal === "open") {
        // Opening, or re-opening after a response that was not enough.
        const due = body.dueAt ? new Date(body.dueAt) : defaultDueDate(now);
        if (Number.isNaN(due.getTime()) || due.getTime() < now.getTime() - 86_400_000) {
          return NextResponse.json({ ok: false, error: "The response due date is not valid." }, { status: 400 });
        }
        updates.opened_at = now.toISOString();
        updates.due_at = due.toISOString();
        updates.responded_at = null;
        mintLink(due);
      }
      if (goal === "verified") updates.verified_at = now.toISOString();
      if (goal === "closed" || goal === "rejected") updates.response_nonce = null;
    }

    if (body.citationState) updates.citation_state = body.citationState;
    if (body.citationExplanation !== undefined) updates.citation_explanation = body.citationExplanation;
    if (path.length > 0) updates.state = path[path.length - 1];

    // The state guard in the filter stops two people moving the same issue at once.
    const { data: written, error } = await supabase
      .from("findings")
      // citation_* columns arrive with migration 0010 and are not on the
      // hand-written Database types.
      .update(updates as never)
      .eq("id", finding.id)
      .eq("organization_id", organizationId)
      .eq("state", finding.state)
      .select("id");
    if (error) throw new Error(error.message);
    if (!written || written.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Someone else changed this issue. Reload and try again." },
        { status: 409 }
      );
    }

    if (body.action === "recordResponse") {
      const { data: resp, error: rErr } = await supabase
        .from("issue_responses")
        .insert({
          organization_id: organizationId,
          engagement_id: finding.engagement_id,
          finding_id: finding.id,
          kind: "verifier",
          responder_name: body.responderName ?? "Entity (recorded by verifier)",
          body: body.responseBody!,
          recorded_by: session.user.id,
        })
        .select("id")
        .single();
      if (rErr) throw new Error(rErr.message);
      recordedResponseId = resp.id;
    }

    await auditEvent({
      organizationId,
      actorUserId: session.user.id,
      action: body.polish
        ? "finding.drafted"
        : body.action
          ? `finding.${body.action}`
          : path.length > 1
            ? "finding.advanced"
            : "finding.updated",
      entityType: "finding",
      entityId: finding.id,
      payload: {
        from: current,
        state: path[path.length - 1] ?? current,
        ...(path.length > 1 ? { path } : {}),
        polished,
        actor: displayNameOf(session.user),
        ...(recordedResponseId ? { responseId: recordedResponseId } : {}),
        ...(updates.due_at ? { dueAt: updates.due_at } : {}),
      },
    });

    const target = path[path.length - 1];
    if (target === "closed" || target === "rejected") {
      const { data: remaining } = await supabase
        .from("findings")
        .select("id, severity, state")
        .eq("engagement_id", body.engagementId)
        .eq("organization_id", organizationId);
      const openBlocks = (remaining ?? []).filter((f) =>
        isBlockingOpen({ severity: f.severity, state: f.state as IssueState })
      );
      if (openBlocks.length === 0) {
        const engagement = await getEngagement(body.engagementId, organizationId);
        if (engagement) {
          await ensureEngagementStatus({
            organizationId,
            actorUserId: session.user.id,
            engagementId: engagement.id,
            current: engagement.status,
            target: "signoff",
          });
        }
      }
    }

    return NextResponse.json({ ok: true, polished, responseLink });
  } catch (e) {
    return jsonError(e);
  }
}
