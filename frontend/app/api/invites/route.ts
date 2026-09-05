import { NextResponse } from "next/server";
import { verifyFirmInvite } from "@verifystack/backend/lib/auth/firmInvite";
import { createServiceClient } from "@verifystack/backend/lib/supabase/admin";
import { ROLE_LABEL } from "@verifystack/backend/lib/auth/roles";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  let payload: ReturnType<typeof verifyFirmInvite> = null;
  try {
    payload = verifyFirmInvite(token);
  } catch {
    payload = null;
  }
  if (!payload) {
    return NextResponse.json(
      { ok: false, error: "This invite link is invalid or has expired." },
      { status: 404 }
    );
  }

  const admin = createServiceClient();
  let firmName = "your firm";
  if (admin) {
    const { data } = await admin
      .from("organizations")
      .select("name")
      .eq("id", payload.organizationId)
      .maybeSingle();
    if (data?.name) firmName = data.name;
  }

  return NextResponse.json({
    ok: true,
    email: payload.email,
    role: payload.role,
    roleLabel: ROLE_LABEL[payload.role],
    displayName: payload.displayName,
    firmName,
    expiresAt: new Date(payload.exp).toISOString(),
  });
}
