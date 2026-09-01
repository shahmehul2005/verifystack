import { NextResponse } from "next/server";
import { requireCapability, assertOrgId } from "@verifystack/backend/lib/auth/requireRole";
import { jsonError } from "@/lib/api";
import { createServiceClient } from "@verifystack/backend/lib/supabase/admin";
import { createServerSupabase } from "@verifystack/backend/lib/supabase/server";
import { getEngagement, resetForAdeetiePhase } from "@verifystack/backend/lib/data/engagements";
import {
  assertPhaseAdvanceReady,
  projectSavingsFromMeasures,
  type AdeetieMeasureDraft,
} from "@verifystack/backend/domain/adeetie/lifecycle";
import { openBlockFindings } from "@verifystack/backend/domain/signoff/guards";
import { MIN_ENERGY_SAVINGS_PCT } from "@verifystack/backend/domain/packs/adeetie";
import { isAdeetiePhase } from "@verifystack/backend/domain/packs/adeetie/phases";
import type { Status } from "@verifystack/backend/domain/engagements/status";
import type { SecResult } from "@verifystack/backend/domain/calc/sec";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireCapability("adeetie.operate");
    const organizationId = assertOrgId(session.organizationId);
    const { id } = await params;
    const engagement = await getEngagement(id, organizationId);
    if (!engagement) {
      return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    }
    if (engagement.scheme !== "ADEETIE") {
      return NextResponse.json(
        { ok: false, error: "Only ADEETIE engagements have IGEA / DPR / M&V phases." },
        { status: 409 }
      );
    }
    const phase = engagement.adeetie_phase;
    if (!phase || !isAdeetiePhase(phase)) {
      return NextResponse.json(
        { ok: false, error: "Engagement has no ADEETIE phase." },
        { status: 409 }
      );
    }

    const supabase = createServiceClient() ?? (await createServerSupabase());
    if (!supabase) {
      return NextResponse.json({ ok: false, error: "Supabase is not configured" }, { status: 503 });
    }

    const [{ data: findings }, { data: runs }, { data: measureRows }] = await Promise.all([
      supabase
        .from("findings")
        .select("id, severity, state")
        .eq("engagement_id", id)
        .eq("organization_id", organizationId),
      supabase
        .from("calculation_runs")
        .select("result, sec_phase")
        .eq("engagement_id", id)
        .eq("organization_id", organizationId)
        .eq("method", "SEC"),
      supabase
        .from("adeetie_measures")
        .select("projected_annual_saving, saving_unit")
        .eq("engagement_id", id)
        .eq("organization_id", organizationId),
    ]);

    const hasBaselineSec = (runs ?? []).some((r) => {
      const phaseCol = (r as { sec_phase?: string }).sec_phase;
      if (phaseCol === "baseline") return true;
      const result = r.result as Partial<SecResult> | null;
      return result?.phase === "baseline";
    });

    const baselineRow = (runs ?? []).find((r) => {
      const phaseCol = (r as { sec_phase?: string }).sec_phase;
      if (phaseCol === "baseline") return true;
      return (r.result as Partial<SecResult> | null)?.phase === "baseline";
    });
    const baseline = baselineRow?.result as SecResult | undefined;

    const measureDrafts: AdeetieMeasureDraft[] = (measureRows ?? []).map((m) => ({
      description: "recorded",
      projectedAnnualSaving: Number(m.projected_annual_saving),
      savingUnit: m.saving_unit,
      capitalCostINR: 0,
      basis: "recorded",
    }));

    let projected = null;
    if (baseline && measureDrafts.length > 0) {
      try {
        projected = projectSavingsFromMeasures(
          baseline.totalEnergy,
          measureDrafts,
          MIN_ENERGY_SAVINGS_PCT
        );
      } catch {
        projected = null;
      }
    }

    const next = assertPhaseAdvanceReady({
      position: { status: engagement.status as Status, phase },
      hasBaselineSec,
      openBlockCount: openBlockFindings(findings ?? []).length,
      measureCount: measureRows?.length ?? 0,
      loanAmountINR: engagement.loan_amount_inr,
      projectCostINR: engagement.project_cost_inr,
      projected,
    });

    await resetForAdeetiePhase({
      organizationId,
      engagementId: id,
      fromPhase: phase,
      fromStatus: engagement.status as Status,
      toPhase: next.phase!,
    });

    return NextResponse.json({ ok: true, phase: next.phase, status: next.status });
  } catch (e) {
    return jsonError(e);
  }
}
