import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession, assertOrgId } from "@verifystack/backend/lib/auth/requireRole";
import { jsonError } from "@/lib/api";
import { createServerSupabase } from "@verifystack/backend/lib/supabase/server";
import { createServiceClient } from "@verifystack/backend/lib/supabase/admin";
import { getEngagement, ensureEngagementStatus } from "@verifystack/backend/lib/data/engagements";
import { auditEvent } from "@verifystack/backend/lib/auth/auditEvent";
import type { RuleFinding } from "@verifystack/backend/domain/rules/types";

const PatchBody = z.object({
  engagementId: z.string().uuid(),
  findingId: z.string().uuid(),
  state: z.enum(["suggested", "accepted", "edited", "rejected", "closed"]).optional(),
  polish: z.boolean().optional(),
});

export async function PATCH(req: Request) {
  return handle(req);
}

export async function POST(req: Request) {
  return handle(req);
}

async function handle(req: Request) {
  try {
    const session = await requireSession();
    const organizationId = assertOrgId(session.organizationId);
    const parsed = PatchBody.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: "Invalid body" }, { status: 400 });
    }
    const supabase = createServiceClient() ?? (await createServerSupabase());
    if (!supabase) {
      return NextResponse.json({ ok: false, error: "Supabase is not configured" }, { status: 503 });
    }
    const { data: finding } = await supabase
      .from("findings")
      .select("*")
      .eq("id", parsed.data.findingId)
      .eq("organization_id", organizationId)
      .eq("engagement_id", parsed.data.engagementId)
      .single();
    if (!finding) {
      return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    }

    let polished = false;
    const updates: {
      updated_at: string;
      body?: string;
      heading?: string;
      generator?: string;
      state?: typeof parsed.data.state;
    } = { updated_at: new Date().toISOString() };

    if (parsed.data.polish) {
      const ruleFinding: RuleFinding = {
        ruleId: finding.rule_id,
        severity: finding.severity,
        title: finding.title,
        detail: finding.detail,
        clauseRef: finding.clause_ref,
        evidenceRefs: (finding.evidence_refs as string[]) ?? [],
        magnitude: finding.magnitude as RuleFinding["magnitude"],
      };
      const draftRes = await fetch(new URL("/api/draft-finding", req.url), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ruleFinding),
      });
      const draftJson = (await draftRes.json()) as {
        ok?: boolean;
        polished?: boolean;
        draft?: { body: string; heading: string; generator: string };
      };
      if (draftJson.ok && draftJson.draft) {
        updates.body = draftJson.draft.body;
        updates.heading = draftJson.draft.heading;
        updates.generator = draftJson.draft.generator;
        polished = Boolean(draftJson.polished);
      }
    }

    if (parsed.data.state) updates.state = parsed.data.state;

    const { error } = await supabase
      .from("findings")
      .update(updates)
      .eq("id", finding.id)
      .eq("organization_id", organizationId);
    if (error) throw new Error(error.message);

    await auditEvent({
      organizationId,
      action: parsed.data.polish ? "finding.drafted" : "finding.updated",
      entityType: "finding",
      entityId: finding.id,
      payload: { state: parsed.data.state ?? finding.state, polished },
    });

    if (parsed.data.state === "closed" || parsed.data.state === "rejected") {
      const { data: remaining } = await supabase
        .from("findings")
        .select("id, severity, state")
        .eq("engagement_id", parsed.data.engagementId)
        .eq("organization_id", organizationId);
      const openBlocks = (remaining ?? []).filter(
        (f) => f.severity === "block" && f.state !== "closed" && f.state !== "rejected"
      );
      if (openBlocks.length === 0) {
        const engagement = await getEngagement(parsed.data.engagementId, organizationId);
        if (engagement) {
          await ensureEngagementStatus({
            organizationId,
            engagementId: engagement.id,
            current: engagement.status,
            target: "signoff",
          });
        }
      }
    }

    return NextResponse.json({ ok: true, polished });
  } catch (e) {
    return jsonError(e);
  }
}
