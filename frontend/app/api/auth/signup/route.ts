import { NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@verifystack/backend/lib/supabase/admin";
import { signupGate } from "@verifystack/backend/lib/auth/signupPolicy";

const Body = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(200),
});

/**
 * Creates a user without sending mail (hosted Auth hits the mail cap on new
 * projects). Refuses to change the password of an existing account.
 *
 * This is a service-role call reachable without a session, so who may use it is
 * decided by `signupPolicy`. Leaving it wide open is right for a pilot and wrong
 * for a firm with real engagements — set AUTH_SIGNUP_ALLOWED_DOMAINS or
 * AUTH_OPEN_SIGNUP=false before onboarding a customer.
 */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Email and a password of at least 8 characters are required." },
      { status: 400 }
    );
  }

  const { email, password } = parsed.data;

  const gate = signupGate(email);
  if (!gate.allowed) {
    return NextResponse.json({ ok: false, error: gate.reason }, { status: 403 });
  }

  const admin = createServiceClient();
  if (!admin) {
    return NextResponse.json(
      { ok: false, error: "SUPABASE_SERVICE_ROLE is not configured" },
      { status: 503 }
    );
  }

  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (!created.error) {
    return NextResponse.json({ ok: true });
  }

  const already =
    /already|registered|exists/i.test(created.error.message) ||
    created.error.status === 422;

  if (already) {
    return NextResponse.json(
      { ok: false, error: "Could not create the account. Sign in or reset your password." },
      { status: 409 }
    );
  }

  return NextResponse.json({ ok: false, error: created.error.message }, { status: 400 });
}
