import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability, assertOrgId } from "@verifystack/backend/lib/auth/requireRole";
import { createServiceClient } from "@verifystack/backend/lib/supabase/admin";
import { createServerSupabase } from "@verifystack/backend/lib/supabase/server";
import {
  loadCalendarGridForEngagement,
  saveCalendarReading,
} from "@verifystack/backend/lib/data/calendarStore";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const session = await requireCapability("review.decide");
    const organizationId = assertOrgId(session.organizationId);

    const { searchParams } = new URL(req.url);
    const engagementId = searchParams.get("engagementId");
    if (!engagementId) {
      return NextResponse.json({ ok: false, error: "Missing engagementId" }, { status: 400 });
    }

    const supabase = createServiceClient() ?? (await createServerSupabase());
    if (!supabase) {
      return NextResponse.json({ ok: false, error: "Database not configured" }, { status: 503 });
    }

    const grid = await loadCalendarGridForEngagement(supabase, engagementId, organizationId);
    return NextResponse.json({ ok: true, grid });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

const PostSchema = z.object({
  engagementId: z.string().uuid(),
  streamKey: z.string().min(1),
  monthKey: z.string().min(4), // "2023-04" or "annual"
  readingDate: z.string().optional().nullable(), // e.g. "2023-05-12"
  sourceType: z.enum(["sourcing", "corroboration", "proforma"]),
  valueNumeric: z.number(),
  unit: z.string().optional().nullable(),
  documentId: z.string().uuid().optional().nullable(),
  provenancePage: z.number().int().optional().nullable(),
  provenanceBbox: z
    .object({
      x: z.number(),
      y: z.number(),
      width: z.number(),
      height: z.number(),
    })
    .optional()
    .nullable(),
  provenanceSourceText: z.string().optional().nullable(),
});

export async function POST(req: Request) {
  try {
    const session = await requireCapability("review.decide");
    const organizationId = assertOrgId(session.organizationId);

    const json = await req.json().catch(() => null);
    const parsed = PostSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: "Invalid payload", issues: parsed.error.issues },
        { status: 400 }
      );
    }

    const supabase = createServiceClient() ?? (await createServerSupabase());
    if (!supabase) {
      return NextResponse.json({ ok: false, error: "Database not configured" }, { status: 503 });
    }

    const res = await saveCalendarReading(supabase, {
      ...parsed.data,
      organizationId,
      reviewedBy: session.user.id,
    });

    if (!res.ok) {
      return NextResponse.json({ ok: false, error: res.error }, { status: 400 });
    }

    return NextResponse.json({ ok: true, id: res.id });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
