import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability, assertOrgId } from "@verifystack/backend/lib/auth/requireRole";
import { jsonError } from "@/lib/api";
import { createServerSupabase } from "@verifystack/backend/lib/supabase/server";
import { createServiceClient } from "@verifystack/backend/lib/supabase/admin";
import { getEngagement, ensureEngagementStatus } from "@verifystack/backend/lib/data/engagements";
import { factorSetForOrganization } from "@verifystack/backend/lib/data/factors";
import { executeRun, assessRunReadiness, type ProvenancedFact } from "@verifystack/backend/domain/calc/run";
import { executeSecRun } from "@verifystack/backend/domain/calc/secRun";
import { assessSavings, type SecResult } from "@verifystack/backend/domain/calc/sec";
import { runRules } from "@verifystack/backend/domain/rules/rules";
import { reconciliationContextFromFacts } from "@verifystack/backend/domain/rules/fromFacts";
import { runAdeetieRules } from "@verifystack/backend/domain/rules/adeetie";
import type { AdeetieEligibilityInput } from "@verifystack/backend/domain/rules/adeetie";
import type { EnterpriseCategory } from "@verifystack/backend/domain/packs/adeetie";
import { draftCarFromTemplate } from "@verifystack/backend/domain/ai/draftCar";
import { auditEvent } from "@verifystack/backend/lib/auth/auditEvent";
import { canStartWork, loadPack } from "@verifystack/backend/domain/packs";
import { CalcError } from "@verifystack/backend/domain/calc/engine";
import { SecError } from "@verifystack/backend/domain/calc/sec";
import {
  assertSecPhaseAllowed,
  filterFactsForSecPhase,
} from "@verifystack/backend/domain/adeetie/lifecycle";
import { isAdeetiePhase } from "@verifystack/backend/domain/packs/adeetie/phases";
import type { AdeetiePhase } from "@verifystack/backend/lib/supabase/types";
import type { RuleFinding } from "@verifystack/backend/domain/rules/types";
import type { Database, Json } from "@verifystack/backend/lib/supabase/types";

type RunInsert = Database["public"]["Tables"]["calculation_runs"]["Insert"];

const Body = z.object({
  engagementId: z.string().uuid(),
  phase: z.enum(["baseline", "post_implementation"]).optional(),
});

export async function POST(req: Request) {
  try {
    const session = await requireCapability("runs.execute");
    const organizationId = assertOrgId(session.organizationId);
    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: "Invalid body" }, { status: 400 });
    }
    const engagement = await getEngagement(parsed.data.engagementId, organizationId);
    if (!engagement) {
      return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    }
    const pack = loadPack(engagement.pack_id);
    if (!canStartWork(pack)) {
      return NextResponse.json(
        { ok: false, error: "Scaffold packs cannot start active work" },
        { status: 409 }
      );
    }
    const supabase = createServiceClient() ?? (await createServerSupabase());
    if (!supabase) {
      return NextResponse.json({ ok: false, error: "Supabase is not configured" }, { status: 503 });
    }

    const { data: factRows } = await supabase
      .from("facts")
      .select("*")
      .eq("engagement_id", engagement.id)
      .eq("organization_id", organizationId);

    const facts: ProvenancedFact[] = (factRows ?? []).map((f) => ({
      id: f.id,
      field_path: f.field_path,
      value_json: f.value_json,
      unit: f.unit,
      document_id: f.document_id,
      page: f.page,
      bbox: f.bbox,
      source_text: f.source_text,
    }));

    const { data: previousRuns } = await supabase
      .from("calculation_runs")
      .select("*")
      .eq("engagement_id", engagement.id)
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false });

    const previousRunHash = previousRuns?.[0]?.input_hash ?? null;
    const factorSet = await factorSetForOrganization(organizationId);

    if (pack.calculation_method === "SEC") {
      const phase = parsed.data.phase ?? "baseline";
      const currentAdeetiePhase = engagement.adeetie_phase;
      if (engagement.scheme === "ADEETIE" && currentAdeetiePhase && isAdeetiePhase(currentAdeetiePhase)) {
        assertSecPhaseAllowed(currentAdeetiePhase, phase);
      }

      const docIds = [...new Set(facts.map((f) => f.document_id).filter(Boolean))];
      const { data: docs } = docIds.length
        ? await supabase
            .from("documents")
            .select("id, adeetie_phase")
            .eq("engagement_id", engagement.id)
            .in("id", docIds)
        : { data: [] as Array<{ id: string; adeetie_phase: AdeetiePhase | null }> };
      const phaseByDoc = new Map(
        (docs ?? []).map((d) => [d.id, (d.adeetie_phase ?? null) as AdeetiePhase | null])
      );
      const scopedFacts =
        engagement.scheme === "ADEETIE"
          ? filterFactsForSecPhase(facts, phaseByDoc, phase)
          : facts;
      if (scopedFacts.length === 0) {
        return NextResponse.json(
          {
            ok: false,
            error:
              phase === "post_implementation"
                ? "No M&V facts are committed. Upload post-implementation evidence in this phase, extract, and accept fields before running."
                : "No IGEA baseline facts are committed. Upload baseline evidence, extract, and accept fields before running.",
          },
          { status: 422 }
        );
      }

      const readiness = assessRunReadiness(pack, scopedFacts, { draftMode: engagement.draft_mode });
      if (!readiness.canRun) {
        return NextResponse.json(
          { ok: false, error: readiness.blockers.join(" "), readiness },
          { status: 422 }
        );
      }

      const run = executeSecRun({
        engagementId: engagement.id,
        organizationId,
        packId: engagement.pack_id,
        packVersion: engagement.pack_version,
        periodLabel: engagement.compliance_year,
        phase,
        draftMode: engagement.draft_mode,
        facts: scopedFacts,
        previousRunHash,
        factorSet,
      });

      const base: RunInsert = {
        organization_id: organizationId,
        engagement_id: engagement.id,
        engine_version: run.secEngineVersion,
        pack_id: run.packId,
        pack_version: run.packVersion,
        factor_set_version: run.factorSetVersion,
        input_hash: run.inputHash,
        previous_run_hash: run.previousRunHash,
        inputs: run.input as unknown as Json,
        result: run.result as unknown as Json,
        draft_mode: run.draftMode,
        created_by: session.user.id,
      };
      // SEC projection columns from migration 0003, which the hand-written
      // Database types do not describe yet.
      const secColumns = {
        method: "SEC",
        chain_hash: run.chainHash,
        sec_engine_version: run.secEngineVersion,
        period_label: run.result.periodLabel,
        sec_phase: run.result.phase,
        total_energy_mj: run.result.totalEnergyMJ.value,
        total_energy: run.result.totalEnergy.value,
        reporting_energy_unit: run.result.totalEnergy.unit,
        sec: run.result.sec,
        sec_unit_label: run.result.secUnitLabel,
        production: run.result.production.value,
        product_unit_label: run.result.productUnitLabel,
      };

      const { data: stored, error } = await supabase
        .from("calculation_runs")
        .insert({ ...base, ...secColumns } as RunInsert)
        .select("*")
        .single();
      if (error) throw new Error(error.message);

      const findings = adeetieFindings({
        engagement,
        pack,
        thisRun: run.result,
        previousResults: (previousRuns ?? []).map((r) => r.result),
      });
      await insertFindings(supabase, organizationId, engagement.id, stored.id, findings);

      await auditEvent({
        organizationId,
        action: "calculation.ran",
        entityType: "calculation_run",
        entityId: stored.id,
        payload: {
          method: "SEC",
          sec_phase: phase,
          input_hash: run.inputHash,
          sec_engine_version: run.secEngineVersion,
          pack_version: run.packVersion,
          chain_hash: run.chainHash,
        },
      });

      await ensureEngagementStatus({
        organizationId,
        engagementId: engagement.id,
        current: engagement.status,
        target: "findings",
      });

      return NextResponse.json({ ok: true, run: stored });
    }

    const readiness = assessRunReadiness(pack, facts, { draftMode: engagement.draft_mode });
    if (!readiness.canRun) {
      return NextResponse.json(
        { ok: false, error: readiness.blockers.join(" "), readiness },
        { status: 422 }
      );
    }

    const run = executeRun({
      engagementId: engagement.id,
      organizationId,
      packId: engagement.pack_id,
      packVersion: engagement.pack_version,
      complianceYear: engagement.compliance_year,
      geiTarget: engagement.gei_target != null ? Number(engagement.gei_target) : undefined,
      draftMode: engagement.draft_mode,
      facts,
      previousRunHash,
      factorSet,
    });

    const { data: stored, error } = await supabase
      .from("calculation_runs")
      .insert({
        organization_id: organizationId,
        engagement_id: engagement.id,
        engine_version: run.engineVersion,
        pack_id: run.packId,
        pack_version: run.packVersion,
        factor_set_version: run.factorSetVersion,
        input_hash: run.inputHash,
        previous_run_hash: run.previousRunHash,
        inputs: run.input as unknown as Json,
        result: run.result as unknown as Json,
        draft_mode: run.draftMode,
        created_by: session.user.id,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);

    const rules = runRules(
      reconciliationContextFromFacts({
        complianceYear: engagement.compliance_year,
        calc: run.result,
        facts,
      })
    );
    await insertFindings(supabase, organizationId, engagement.id, stored.id, rules.findings);

    await auditEvent({
      organizationId,
      action: "calculation.ran",
      entityType: "calculation_run",
      entityId: stored.id,
      payload: {
        method: "GEI",
        input_hash: run.inputHash,
        engine_version: run.engineVersion,
        pack_version: run.packVersion,
        chain_hash: run.chainHash,
      },
    });

    await ensureEngagementStatus({
      organizationId,
      engagementId: engagement.id,
      current: engagement.status,
      target: "findings",
    });

    return NextResponse.json({ ok: true, run: stored });
  } catch (e) {
    if (e instanceof CalcError || e instanceof SecError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 422 });
    }
    return jsonError(e);
  }
}

async function insertFindings(
  supabase: NonNullable<Awaited<ReturnType<typeof createServerSupabase>>>,
  organizationId: string,
  engagementId: string,
  calculationRunId: string,
  findings: RuleFinding[]
) {
  if (!findings.length) return;
  const rows = findings.map((f) => {
    const car = draftCarFromTemplate(f);
    return {
      organization_id: organizationId,
      engagement_id: engagementId,
      calculation_run_id: calculationRunId,
      rule_id: f.ruleId,
      severity: f.severity,
      title: f.title,
      detail: f.detail,
      clause_ref: f.clauseRef,
      evidence_refs: f.evidenceRefs,
      magnitude: (f.magnitude ?? null) as Json,
      state: "suggested" as const,
      heading: car.heading,
      body: car.body,
      required_response: car.requiredResponse,
      generator: car.generator,
    };
  });
  await supabase.from("findings").insert(rows);
}

function isSecResult(value: unknown): value is SecResult {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Partial<SecResult>;
  return typeof v.secEngineVersion === "string" && typeof v.sec === "number";
}

/**
 * ADEETIE rules over what this engagement actually holds.
 *
 * The energy-balance, baseline-completeness and calibration rules need a monthly
 * series and meter certificates that intake does not yet capture, so they are
 * given empty inputs and stay silent rather than being fed invented data. That
 * silence is a known gap, not a pass: AD-EB001, AD-TS001 and AD-CAL001 cannot
 * fire until intake carries monthly readings and calibration certificates.
 *
 * Eligibility is evaluated only when the enterprise category was recorded at
 * setup, because without it there is no scheme category to test against.
 */
function adeetieFindings({
  engagement,
  pack,
  thisRun,
  previousResults,
}: {
  engagement: { id: string; client_name: string; sector_or_cluster: string; compliance_year: string };
  pack: ReturnType<typeof loadPack>;
  thisRun: SecResult;
  previousResults: unknown[];
}): RuleFinding[] {
  const priorSec = previousResults.filter(isSecResult);
  const baseline =
    thisRun.phase === "baseline"
      ? thisRun
      : (priorSec.find((r) => r.phase === "baseline") ?? undefined);
  const post =
    thisRun.phase === "post_implementation"
      ? thisRun
      : (priorSec.find((r) => r.phase === "post_implementation") ?? undefined);

  const thresholdPct = pack.sec_config?.minSavingsPct;
  let savings;
  if (baseline && post) {
    try {
      savings = assessSavings(baseline, post, thresholdPct);
    } catch {
      savings = undefined;
    }
  }

  const e = engagement as unknown as Record<string, unknown>;
  const category = e.enterprise_category;
  let eligibility: AdeetieEligibilityInput | undefined;
  if (category === "Micro" || category === "Small" || category === "Medium") {
    eligibility = {
      enterpriseName: engagement.client_name,
      category: category as EnterpriseCategory,
      sector: engagement.sector_or_cluster,
      cluster: typeof e.adeetie_cluster === "string" ? e.adeetie_cluster : "",
      loanAmountINR: Number(e.loan_amount_inr ?? 0),
      projectCostINR: Number(e.project_cost_inr ?? 0),
      factIds: [],
      ...(typeof e.udyam_registration_no === "string"
        ? { udyamRegistrationNo: e.udyam_registration_no }
        : {}),
      ...(e.sanctioned_interest_rate_pct != null
        ? { sanctionedRatePct: Number(e.sanctioned_interest_rate_pct) }
        : {}),
      // Migration 0009. A unit outside a notified cluster may still qualify on
      // a 200 km proximity claim, so AD-ELG002 needs the claimed distance to
      // judge it rather than blocking every non-cluster address outright.
      ...(e.claimed_distance_to_cluster_km != null
        ? { claimedDistanceToClusterKm: Number(e.claimed_distance_to_cluster_km) }
        : {}),
    };
  }

  return runAdeetieRules({
    baselinePeriodLabel: engagement.compliance_year,
    expectedMonths: [],
    energyBalance: [],
    meterCalibrations: [],
    ...(baseline ? { baselineSec: baseline } : {}),
    ...(post ? { postSec: post } : {}),
    ...(savings ? { savings } : {}),
    ...(eligibility ? { eligibility } : {}),
  }).findings;
}
