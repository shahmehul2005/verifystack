import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@verifystack/backend/lib/auth/requireRole";
import { parseMembershipRole } from "@verifystack/backend/lib/auth/roles";
import { createServiceClient } from "@verifystack/backend/lib/supabase/admin";
import { jsonError } from "@/lib/api";
import type { MembershipRole } from "@verifystack/backend/lib/supabase/types";

const Body = z.object({
  firmName: z.string().min(2).max(120).optional(),
  kind: z.enum(["acva", "energy_auditor_firm"]).optional(),
  role: z.enum(["firm_admin", "lead_verifier", "verifier", "independent_reviewer"]).optional(),
});

/**
 * First-user path. RLS cannot create the first org (membership is required to
 * write organizations), so this uses the service role after confirming the
 * caller is signed in and has no membership yet.
 */
export async function POST(req: Request) {
  try {
    const session = await requireSession();
    if (session.organizationId) {
      return NextResponse.json({
        ok: true,
        organizationId: session.organizationId,
        alreadyMember: true,
        role: session.role,
      });
    }

    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: "Invalid body" }, { status: 400 });
    }

    const admin = createServiceClient();
    if (!admin) {
      return NextResponse.json(
        { ok: false, error: "SUPABASE_SERVICE_ROLE is not configured" },
        { status: 503 }
      );
    }

    const { data: existing } = await admin
      .from("memberships")
      .select("organization_id, role")
      .eq("user_id", session.user.id)
      .limit(1);
    if (existing?.[0]) {
      return NextResponse.json({
        ok: true,
        organizationId: existing[0].organization_id,
        alreadyMember: true,
        role: existing[0].role,
      });
    }

    const email = session.user.email ?? "verifier";
    const meta = session.user.user_metadata ?? {};
    const displayName =
      (typeof meta.full_name === "string" && meta.full_name) ||
      (typeof meta.name === "string" && meta.name) ||
      email;
    const role: MembershipRole =
      parsed.data.role ??
      parseMembershipRole(meta.intended_role) ??
      "firm_admin";
    const defaultName =
      parsed.data.firmName ??
      `${email.split("@")[0]} verification firm`;

    const { data: org, error: orgError } = await admin
      .from("organizations")
      .insert({
        name: defaultName,
        kind: parsed.data.kind ?? "acva",
      })
      .select("id")
      .single();
    if (orgError || !org) {
      return NextResponse.json(
        { ok: false, error: orgError?.message ?? "Could not create organisation" },
        { status: 500 }
      );
    }

    const { error: memError } = await admin.from("memberships").insert({
      organization_id: org.id,
      user_id: session.user.id,
      role,
      display_name: displayName,
    });
    if (memError) {
      return NextResponse.json({ ok: false, error: memError.message }, { status: 500 });
    }

    await admin.rpc("append_audit_event", {
      p_organization_id: org.id,
      p_action: "org.bootstrap",
      p_entity_type: "organization",
      p_entity_id: org.id,
      p_payload: { created_by: session.user.id, role },
    });

    return NextResponse.json({ ok: true, organizationId: org.id, alreadyMember: false, role });
  } catch (error) {
    return jsonError(error);
  }
}
