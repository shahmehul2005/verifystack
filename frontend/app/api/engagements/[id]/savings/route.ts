import { NextResponse } from "next/server";
import { requireCapability, assertOrgId } from "@verifystack/backend/lib/auth/requireRole";
import { jsonError } from "@/lib/api";
import { createServiceClient } from "@verifystack/backend/lib/supabase/admin";
import { createServerSupabase } from "@verifystack/backend/lib/supabase/server";
import { getEngagement } from "@verifystack/backend/lib/data/engagements";
import { auditEvent } from "@verifystack/backend/lib/auth/auditEvent";
import { loadPack } from "@verifystack/backend/domain/packs";
import { MIN_ENERGY_SAVINGS_PCT } from "@verifystack/backend/domain/packs/adeetie";
import {
  SavingsDprError,
  calculateSavingsDpr,
  chainSavingsDprHash,
  hashSavingsDprInput,
  type SavingsDprInput,
} from "@verifystack/backend/domain/savings/dpr";
import type { SecResult } from "@verifystack/backend/domain/calc/sec";
import type { Json } from "@verifystack/backend/lib/supabase/types";

/**
 * Record a savings and simple-payback run over the engagement's recorded
 * measures. Separate from the SEC engine and from the phase gate: it reports
 * what the measures would save, it does not decide anything.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireCapability("adeetie.operate");
    const organizationId = assertOrgId(session.organizationId);
    const { id } = await params;
    const engagement = await getEngagement(id, organizationId);
    if (!engagement) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    if (engagement.scheme !== "ADEETIE") {
      return NextResponse.json({ ok: false, error: "Savings and payback belong to ADEETIE engagements." }, { status: 409 });
    }
    const supabase = createServiceClient() ?? (await createServerSupabase());
    if (!supabase) return NextResponse.json({ ok: false, error: "Supabase is not configured" }, { status: 503 });

    const [{ data: runs }, { data: measures }, { data: previous }] = await Promise.all([
      supabase
        .from("calculation_runs")
        .select("result, sec_phase, created_at")
        .eq("engagement_id", id)
        .eq("organization_id", organizationId)
        .eq("method", "SEC")
        .order("created_at", { ascending: false }),
      supabase
        .from("adeetie_measures")
        .select("*")
        .eq("engagement_id", id)
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: true }),
      supabase
        .from("savings_dpr_runs")
        .select("chain_hash")
        .eq("engagement_id", id)
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false })
        .limit(1),
    ]);

    const baselineRow = (runs ?? []).find(
      (r) => r.sec_phase === "baseline" || (r.result as Partial<SecResult> | null)?.phase === "baseline"
    );
    const baseline = baselineRow?.result as SecResult | undefined;
    if (!baseline?.totalEnergy) {
      throw new SavingsDprError("Run the baseline SEC calculation first. Savings are measured against it.");
    }
    const unit = baseline.totalEnergy.unit as string;
    const wrongUnit = (measures ?? []).find((m) => m.saving_unit !== unit);
    if (wrongUnit) {
      throw new SavingsDprError(
        `"${wrongUnit.description}" is recorded in ${wrongUnit.saving_unit} but the baseline is in ${unit}. Record it in ${unit}.`
      );
    }

    const input: SavingsDprInput = {
      baselineEnergy: { value: baseline.totalEnergy.value, unit },
      energyUnit: unit,
      minSavingsPct: loadPack(engagement.pack_id).sec_config?.minSavingsPct ?? MIN_ENERGY_SAVINGS_PCT,
      measures: (measures ?? []).map((m) => ({
        id: m.id,
        description: m.description,
        annualEnergySaving: Number(m.projected_annual_saving),
        capitalCostINR: Number(m.capital_cost_inr),
        annualCostSavingINR: m.annual_cost_saving_inr == null ? null : Number(m.annual_cost_saving_inr),
      })),
    };
    const result = calculateSavingsDpr(input);
    const inputHash = hashSavingsDprInput(input);
    const previousHash = previous?.[0]?.chain_hash ?? null;

    const { data: row, error } = await supabase
      .from("savings_dpr_runs")
      .insert({
        organization_id: organizationId,
        engagement_id: id,
        engine_version: result.engineVersion,
        input_hash: inputHash,
        previous_run_hash: previousHash,
        chain_hash: chainSavingsDprHash(inputHash, previousHash),
        inputs: input as unknown as Json,
        result: result as unknown as Json,
        created_by: session.user.id,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    await auditEvent({
      organizationId,
      actorUserId: session.user.id,
      action: "savings_dpr.computed",
      entityType: "savings_dpr_run",
      entityId: row.id,
      payload: { input_hash: inputHash, measures: input.measures.length, engine: result.engineVersion },
    });

    return NextResponse.json({ ok: true, id: row.id, result });
  } catch (e) {
    if (e instanceof SavingsDprError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 422 });
    }
    return jsonError(e);
  }
}
