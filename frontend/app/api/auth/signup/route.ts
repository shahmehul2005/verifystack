import { NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@verifystack/backend/lib/supabase/admin";

const Body = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(200),
});

/**
 * Creates (or confirms) a user without sending mail. The hosted Auth
 * confirmation path hits Supabase's email rate limit on new projects.
 */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Email and a password of at least 8 characters are required." }, { status: 400 });
  }

  const admin = createServiceClient();
  if (!admin) {
    return NextResponse.json(
      { ok: false, error: "SUPABASE_SERVICE_ROLE is not configured" },
      { status: 503 }
    );
  }

  const { email, password } = parsed.data;

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

  if (!already) {
    return NextResponse.json({ ok: false, error: created.error.message }, { status: 400 });
  }

  const { data: listed, error: listError } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 200,
  });
  if (listError) {
    return NextResponse.json({ ok: false, error: listError.message }, { status: 400 });
  }

  const existing = listed.users.find(
    (u) => u.email?.toLowerCase() === email.toLowerCase()
  );
  if (!existing) {
    return NextResponse.json(
      { ok: false, error: "That email is already registered. Sign in instead." },
      { status: 409 }
    );
  }

  const updated = await admin.auth.admin.updateUserById(existing.id, {
    password,
    email_confirm: true,
  });
  if (updated.error) {
    return NextResponse.json({ ok: false, error: updated.error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, recovered: true });
}
