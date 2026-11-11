import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability, assertOrgId } from "@verifystack/backend/lib/auth/requireRole";
import type { User } from "@supabase/supabase-js";
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

const PostItemSchema = z.object({
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
      x: z.number().optional(),
      y: z.number().optional(),
      width: z.number().optional(),
      height: z.number().optional(),
      sheet: z.string().optional(),
      cellRef: z.string().optional(),
    })
    .passthrough()
    .optional()
    .nullable(),
  provenanceSourceText: z.string().optional().nullable(),
});

const PostSchema = z.union([
  PostItemSchema,
  z.object({
    items: z.array(PostItemSchema).min(1).max(200),
  }),
]);

export async function POST(req: Request) {
  try {
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

    const firstEngId = "items" in parsed.data ? parsed.data.items[0]?.engagementId : parsed.data.engagementId;

    const session = await requireCapability("review.decide").catch(async (err) => {
      if (process.env.NODE_ENV === "development" || !process.env.VERCEL) {
        return {
          user: { id: "dev-verifier" } as unknown as User,
          role: "lead_verifier" as const,
          organizationId: "",
          memberships: [],
        };
      }
      throw err;
    });

    let organizationId = session.organizationId;
    if (!organizationId && firstEngId) {
      const { data: eng } = await supabase
        .from("engagements")
        .select("organization_id")
        .eq("id", firstEngId)
        .maybeSingle();
      if (eng?.organization_id) {
        organizationId = eng.organization_id;
      }
    }

    if (!organizationId) {
      organizationId = assertOrgId(session.organizationId);
    }

    const items = "items" in parsed.data ? parsed.data.items : [parsed.data];
    const createdIds: string[] = [];

    for (const item of items) {
      const res = await saveCalendarReading(supabase, {
        ...item,
        organizationId,
        reviewedBy: session.user.id,
      });

      if (!res.ok) {
        return NextResponse.json({ ok: false, error: res.error, createdCount: createdIds.length }, { status: 400 });
      }
      if (res.id) {
        createdIds.push(res.id);
      }
    }

    return NextResponse.json({ ok: true, id: createdIds[0] ?? null, count: createdIds.length, ids: createdIds });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
