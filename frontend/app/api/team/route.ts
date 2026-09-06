import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability, assertOrgId } from "@verifystack/backend/lib/auth/requireRole";
import { jsonError } from "@/lib/api";
import { createServiceClient } from "@verifystack/backend/lib/supabase/admin";
import { createServerSupabase } from "@verifystack/backend/lib/supabase/server";
import { auditEvent } from "@verifystack/backend/lib/auth/auditEvent";
import { inviteSignupUrl, signFirmInvite } from "@verifystack/backend/lib/auth/firmInvite";
import { sendTeamInviteEmail } from "@verifystack/backend/lib/email/invite";
import type { MembershipRole } from "@verifystack/backend/lib/supabase/types";

const PatchBody = z.object({
  membershipId: z.string().uuid(),
  role: z.enum(["firm_admin", "lead_verifier", "verifier", "independent_reviewer"]),
});

const InviteBody = z.object({
  email: z.string().email(),
  role: z.enum(["firm_admin", "lead_verifier", "verifier", "independent_reviewer"]),
  displayName: z.string().min(1).max(120).optional(),
});

function requestOrigin(req: Request) {
  const origin = req.headers.get("origin");
  if (origin) return origin;
  return new URL(req.url).origin;
}

async function findUserIdByEmail(
  admin: NonNullable<ReturnType<typeof createServiceClient>>,
  email: string
): Promise<string | null> {
  const needle = email.toLowerCase();
  for (let page = 1; page <= 5; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) break;
    const hit = data.users.find((u) => u.email?.toLowerCase() === needle);
    if (hit) return hit.id;
    if (data.users.length < 200) break;
  }
  return null;
}

export async function POST(req: Request) {
  try {
    const session = await requireCapability("team.manage");
    const organizationId = assertOrgId(session.organizationId);
    const parsed = InviteBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: "Email and a role are required." },
        { status: 400 }
      );
    }

    const admin = createServiceClient();
    if (!admin) {
      return NextResponse.json(
        { ok: false, error: "SUPABASE_SERVICE_ROLE is not configured" },
        { status: 503 }
      );
    }

    const email = parsed.data.email.trim().toLowerCase();
    const role: MembershipRole = parsed.data.role;
    const displayName = parsed.data.displayName?.trim() || email.split("@")[0]!;
    const userId = await findUserIdByEmail(admin, email);
    let alreadyOnThisFirm = false;

    if (userId) {
      const { data: existing } = await admin
        .from("memberships")
        .select("id, organization_id")
        .eq("user_id", userId);
      const onThisFirm = existing?.some((m) => m.organization_id === organizationId) ?? false;
      const onOtherFirm = existing?.some((m) => m.organization_id !== organizationId) ?? false;
      alreadyOnThisFirm = onThisFirm;
      if (onOtherFirm && !onThisFirm) {
        return NextResponse.json(
          {
            ok: false,
            error:
              "That email already belongs to another firm. They must use a different address, or a firm admin there must remove them first.",
          },
          { status: 409 }
        );
      }
    }

    const token = signFirmInvite({
      email,
      organizationId,
      role,
      displayName,
    });
    const inviteUrl = inviteSignupUrl(requestOrigin(req), token);
    const { data: organization } = await admin
      .from("organizations")
      .select("name")
      .eq("id", organizationId)
      .maybeSingle();
    const emailed = await sendTeamInviteEmail({
      email,
      displayName,
      organizationName: organization?.name ?? "your firm",
      role,
      inviteUrl,
    });

    await auditEvent({
      organizationId,
      action: "membership.invited",
      entityType: "membership",
      entityId: null,
      payload: { email, role, already_had_account: Boolean(userId) },
    });

    return NextResponse.json({
      ok: true,
      emailed,
      created: !userId,
      alreadyMember: alreadyOnThisFirm,
      inviteUrl,
      role,
    });
  } catch (e) {
    return jsonError(e);
  }
}

export async function PATCH(req: Request) {
  try {
    const session = await requireCapability("team.manage");
    const organizationId = assertOrgId(session.organizationId);
    const parsed = PatchBody.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: "Invalid body" }, { status: 400 });
    }
    const supabase = createServiceClient() ?? (await createServerSupabase());
    if (!supabase) {
      return NextResponse.json({ ok: false, error: "Supabase is not configured" }, { status: 503 });
    }

    const { data: target } = await supabase
      .from("memberships")
      .select("id, role, user_id")
      .eq("id", parsed.data.membershipId)
      .eq("organization_id", organizationId)
      .single();
    if (!target) {
      return NextResponse.json({ ok: false, error: "Member not found" }, { status: 404 });
    }

    if (target.role === "firm_admin" && parsed.data.role !== "firm_admin") {
      const { data: members } = await supabase
        .from("memberships")
        .select("id, role")
        .eq("organization_id", organizationId);
      const admins = (members ?? []).filter((m) => m.role === "firm_admin");
      if (admins.length <= 1 && (members ?? []).length > 1) {
        return NextResponse.json(
          { ok: false, error: "Keep at least one firm admin so Team stays reachable." },
          { status: 409 }
        );
      }
    }

    const { error } = await supabase
      .from("memberships")
      .update({ role: parsed.data.role })
      .eq("id", target.id)
      .eq("organization_id", organizationId);
    if (error) throw new Error(error.message);

    await auditEvent({
      organizationId,
      action: "membership.role_changed",
      entityType: "membership",
      entityId: target.id,
      payload: { from: target.role, to: parsed.data.role, user_id: target.user_id },
    });

    return NextResponse.json({ ok: true, role: parsed.data.role });
  } catch (e) {
    return jsonError(e);
  }
}
