import { NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@verifystack/backend/lib/supabase/admin";
import { signupGate } from "@verifystack/backend/lib/auth/signupPolicy";
import { verifyFirmInvite } from "@verifystack/backend/lib/auth/firmInvite";
import { sendSignupConfirmationEmail } from "@verifystack/backend/lib/email/invite";
import type { MembershipRole } from "@verifystack/backend/lib/supabase/types";

const Body = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(200),
  inviteToken: z.string().min(16).optional(),
});

function requestOrigin(req: Request): string {
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

/**
 * Self-serve (no invite): uses admin.generateLink() to create the user AND
 * obtain the confirmation URL in one call, then sends the URL via Resend
 * directly. The Admin API's createUser() never triggers any email pipeline
 * (even with email_confirm: false), so generateLink is the only reliable path.
 *
 * Invite path: createUser with email_confirm: true — the invite token is the
 * trust signal, no email confirmation needed.
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

  let userId: string | null = await findUserIdByEmail(admin, email);
  let created = false;

  if (!userId) {
    if (invite) {
      // Invite path: create pre-confirmed — no email needed.
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
    } else {
      // Self-serve path: generateLink creates the user AND returns the
      // confirmation URL. We send it via Resend ourselves because the
      // Admin API's createUser() never fires the email pipeline.
      const origin = requestOrigin(req);
      const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
        type: "signup",
        email,
        password,
        options: { redirectTo: `${origin}/auth/callback` },
      });
      if (linkError || !linkData?.user) {
        const already =
          /already|registered|exists/i.test(linkError?.message ?? "") ||
          (linkError as { status?: number } | null)?.status === 422;
        return NextResponse.json(
          {
            ok: false,
            error: already
              ? "Could not create the account. Sign in or reset your password."
              : (linkError?.message ?? "Could not create the account."),
          },
          { status: already ? 409 : 400 }
        );
      }
      userId = linkData.user.id;
      created = true;
      // Fire-and-forget: if Resend fails the user can still confirm later
      // via Supabase dashboard resend, and we log the error server-side.
      void sendSignupConfirmationEmail({
        email,
        confirmationUrl: linkData.properties.action_link,
      });
    }
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
    // True when the user signed up without an invite: they must confirm their
    // email before they can sign in. The form should show a "check your inbox"
    // message and NOT attempt signInWithPassword yet.
    requiresEmailConfirmation: !invite,
    role,
  });
}
