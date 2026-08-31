import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession, assertOrgId } from "@verifystack/backend/lib/auth/requireRole";
import { jsonError } from "@/lib/api";
import { createServiceClient } from "@verifystack/backend/lib/supabase/admin";
import { createServerSupabase } from "@verifystack/backend/lib/supabase/server";
import { getEngagement } from "@verifystack/backend/lib/data/engagements";
import {
  AdeetieLifecycleError,
  assertMeasureDraft,
} from "@verifystack/backend/domain/adeetie/lifecycle";
import { auditEvent } from "@verifystack/backend/lib/auth/auditEvent";

const Body = z.object({
  description: z.string(),
  projectedAnnualSaving: z.number(),
  savingUnit: z.string(),
  capitalCostINR: z.number(),
  basis: z.string(),
});

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireSession();
    const organizationId = assertOrgId(session.organizationId);
    const { id } = await params;
    const engagement = await getEngagement(id, organizationId);
    if (!engagement) {
      return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    }
    const supabase = createServiceClient() ?? (await createServerSupabase());
    if (!supabase) {
      return NextResponse.json({ ok: false, error: "Supabase is not configured" }, { status: 503 });
    }
    const { data, error } = await supabase
      .from("adeetie_measures")
      .select("*")
      .eq("engagement_id", id)
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true, measures: data ?? [] });
  } catch (e) {
    return jsonError(e);
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireSession();
    const organizationId = assertOrgId(session.organizationId);
    const { id } = await params;
    const engagement = await getEngagement(id, organizationId);
    if (!engagement) {
      return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    }
    if (engagement.scheme !== "ADEETIE") {
      return NextResponse.json(
        { ok: false, error: "Measures belong to ADEETIE engagements." },
        { status: 409 }
      );
    }
    if (engagement.adeetie_phase === "MV") {
      throw new AdeetieLifecycleError(
        "Measures are locked during M&V. They were recorded in IGEA / DPR."
      );
    }
    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: "Invalid body" }, { status: 400 });
    }
    assertMeasureDraft(parsed.data);

    const supabase = createServiceClient() ?? (await createServerSupabase());
    if (!supabase) {
      return NextResponse.json({ ok: false, error: "Supabase is not configured" }, { status: 503 });
    }
    const { data, error } = await supabase
      .from("adeetie_measures")
      .insert({
        organization_id: organizationId,
        engagement_id: id,
        description: parsed.data.description.trim(),
        projected_annual_saving: parsed.data.projectedAnnualSaving,
        saving_unit: parsed.data.savingUnit.trim(),
        capital_cost_inr: parsed.data.capitalCostINR,
        basis: parsed.data.basis.trim(),
        created_by: session.user.id,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    await auditEvent({
      organizationId,
      action: "adeetie.measure_added",
      entityType: "adeetie_measure",
      entityId: data.id,
      payload: { engagementId: id, savingUnit: parsed.data.savingUnit },
    });
    return NextResponse.json({ ok: true, measure: data });
  } catch (e) {
    return jsonError(e);
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireSession();
    const organizationId = assertOrgId(session.organizationId);
    const { id } = await params;
    const engagement = await getEngagement(id, organizationId);
    if (!engagement) {
      return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    }
    if (engagement.adeetie_phase === "MV") {
      throw new AdeetieLifecycleError("Measures are locked during M&V.");
    }
    const url = new URL(req.url);
    const measureId = url.searchParams.get("measureId");
    if (!measureId) {
      return NextResponse.json({ ok: false, error: "measureId required" }, { status: 400 });
    }
    const supabase = createServiceClient() ?? (await createServerSupabase());
    if (!supabase) {
      return NextResponse.json({ ok: false, error: "Supabase is not configured" }, { status: 503 });
    }
    const { error } = await supabase
      .from("adeetie_measures")
      .delete()
      .eq("id", measureId)
      .eq("engagement_id", id)
      .eq("organization_id", organizationId);
    if (error) throw new Error(error.message);
    await auditEvent({
      organizationId,
      action: "adeetie.measure_removed",
      entityType: "adeetie_measure",
      entityId: measureId,
      payload: { engagementId: id },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return jsonError(e);
  }
}
