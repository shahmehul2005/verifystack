import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@verifystack/backend/lib/auth/requireRole";
import { createServiceClient } from "@verifystack/backend/lib/supabase/admin";
import { jsonError } from "@/lib/api";

const Body = z.object({
  firmName: z.string().min(2).max(120).optional(),
  kind: z.enum(["acva", "energy_auditor_firm"]).optional(),
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
      .select("organization_id")
      .eq("user_id", session.user.id)
      .limit(1);
    if (existing?.[0]) {
      return NextResponse.json({
        ok: true,
        organizationId: existing[0].organization_id,
        alreadyMember: true,
      });
    }

    const email = session.user.email ?? "verifier";
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
      role: "firm_admin",
      display_name: session.user.email ?? null,
    });
    if (memError) {
      return NextResponse.json({ ok: false, error: memError.message }, { status: 500 });
    }

    await admin.rpc("append_audit_event", {
      p_organization_id: org.id,
      p_action: "org.bootstrap",
      p_entity_type: "organization",
      p_entity_id: org.id,
      p_payload: { created_by: session.user.id },
    });

    return NextResponse.json({ ok: true, organizationId: org.id, alreadyMember: false });
  } catch (error) {
    return jsonError(error);
  }
}
