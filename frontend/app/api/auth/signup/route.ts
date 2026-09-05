import { NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@verifystack/backend/lib/supabase/admin";
import { signupGate } from "@verifystack/backend/lib/auth/signupPolicy";
import { verifyFirmInvite } from "@verifystack/backend/lib/auth/firmInvite";
import type { MembershipRole } from "@verifystack/backend/lib/supabase/types";

const Body = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(200),
  inviteToken: z.string().min(16).optional(),
});

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

/**
 * Creates (or password-completes) a user without sending mail.
 * Self-serve: new firm later via /api/bootstrap as firm_admin.
 * Invite: membership is written here with the role the firm admin chose, and
 * the password is stored on the Auth user so they can sign in afterwards.
 */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Email and a password of at least 8 characters are required." },
      { status: 400 }
    );
  }

  const email = parsed.data.email.trim().toLowerCase();
  const { password } = parsed.data;

  let invite: ReturnType<typeof verifyFirmInvite> = null;
  if (parsed.data.inviteToken) {
    try {
      invite = verifyFirmInvite(parsed.data.inviteToken);
    } catch {
      invite = null;
    }
    if (!invite) {
      return NextResponse.json(
        { ok: false, error: "This invite link is invalid or has expired. Ask your firm admin to send a new one." },
        { status: 400 }
      );
    }
    if (invite.email !== email) {
      return NextResponse.json(
        { ok: false, error: "Use the email address this invite was sent to." },
        { status: 400 }
      );
    }
  } else {
    const gate = signupGate(email);
    if (!gate.allowed) {
      return NextResponse.json({ ok: false, error: gate.reason }, { status: 403 });
    }
  }

  const admin = createServiceClient();
  if (!admin) {
    return NextResponse.json(
      { ok: false, error: "SUPABASE_SERVICE_ROLE is not configured" },
      { status: 503 }
    );
  }

  let userId = await findUserIdByEmail(admin, email);
  let created = false;

  if (!userId) {
    const createdUser = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (createdUser.error || !createdUser.data.user) {
      const already =
        /already|registered|exists/i.test(createdUser.error?.message ?? "") ||
        createdUser.error?.status === 422;
      return NextResponse.json(
        {
          ok: false,
          error: already
            ? "Could not create the account. Sign in or reset your password."
            : (createdUser.error?.message ?? "Could not create the account."),
        },
        { status: already ? 409 : 400 }
      );
    }
    userId = createdUser.data.user.id;
    created = true;
  } else if (invite) {
    const updated = await admin.auth.admin.updateUserById(userId, {
      password,
      email_confirm: true,
    });
    if (updated.error) {
      return NextResponse.json({ ok: false, error: updated.error.message }, { status: 400 });
    }
  } else {
    return NextResponse.json(
      { ok: false, error: "Could not create the account. Sign in or reset your password." },
      { status: 409 }
    );
  }

  let role: MembershipRole = "firm_admin";

  if (invite) {
    const { data: existing } = await admin
      .from("memberships")
      .select("id, organization_id, role")
      .eq("user_id", userId);
    const other = existing?.find((m) => m.organization_id !== invite.organizationId);
    if (other) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "This email already belongs to another firm. Ask an admin there to remove you first.",
        },
        { status: 409 }
      );
    }
    const here = existing?.find((m) => m.organization_id === invite.organizationId);
    if (!here) {
      const { error: memError } = await admin.from("memberships").insert({
        organization_id: invite.organizationId,
        user_id: userId,
        role: invite.role,
        display_name: invite.displayName,
      });
      if (memError) {
        return NextResponse.json({ ok: false, error: memError.message }, { status: 500 });
      }
    }
    role = here?.role ?? invite.role;
  }

  return NextResponse.json({
    ok: true,
    created,
    invited: Boolean(invite),
    role,
  });
}
