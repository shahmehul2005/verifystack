import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability, assertOrgId } from "@verifystack/backend/lib/auth/requireRole";
import { createServiceClient } from "@verifystack/backend/lib/supabase/admin";
import { createServerSupabase } from "@verifystack/backend/lib/supabase/server";
import { commitAnnualRollupsToCalculation } from "@verifystack/backend/lib/data/calendarStore";

export const runtime = "nodejs";

const RollupSchema = z.object({
  engagementId: z.string().uuid(),
});

export async function POST(req: Request) {
  try {
    const session = await requireCapability("review.decide");
    const organizationId = assertOrgId(session.organizationId);

    const json = await req.json().catch(() => null);
    const parsed = RollupSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: "Invalid payload" }, { status: 400 });
    }

    const supabase = createServiceClient() ?? (await createServerSupabase());
    if (!supabase) {
      return NextResponse.json({ ok: false, error: "Database not configured" }, { status: 503 });
    }

    const res = await commitAnnualRollupsToCalculation(
      supabase,
      parsed.data.engagementId,
      organizationId
    );

    return NextResponse.json({ ok: true, ...res });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
