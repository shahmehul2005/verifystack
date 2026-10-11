import { NextResponse } from "next/server";
import { requireCapability, assertOrgId } from "@verifystack/backend/lib/auth/requireRole";
import { jsonError } from "@/lib/api";
import { EngagementCreateSchema } from "@verifystack/backend/domain/engagements/schema";
import { createServerSupabase } from "@verifystack/backend/lib/supabase/server";
import { createServiceClient } from "@verifystack/backend/lib/supabase/admin";
import {
  createEngagementRecord,
  EngagementCreateError,
} from "@verifystack/backend/lib/data/createEngagement";

export async function POST(req: Request) {
  try {
    const session = await requireCapability("engagements.create");
    const organizationId = assertOrgId(session.organizationId);
    const parsed = EngagementCreateSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: "Invalid body" }, { status: 400 });
    }
    const supabase = createServiceClient() ?? (await createServerSupabase());
    if (!supabase) {
      return NextResponse.json({ ok: false, error: "Supabase is not configured" }, { status: 503 });
    }
    const engagement = await createEngagementRecord({
      supabase: supabase as NonNullable<ReturnType<typeof createServiceClient>>,
      organizationId,
      actorUserId: session.user.id,
      input: parsed.data,
    });
    return NextResponse.json({ ok: true, engagement });
  } catch (e) {
    if (e instanceof EngagementCreateError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: e.status });
    }
    return jsonError(e);
  }
}
