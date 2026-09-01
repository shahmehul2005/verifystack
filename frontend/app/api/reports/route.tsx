import { renderToBuffer } from "@react-pdf/renderer";
import type { DocumentProps } from "@react-pdf/renderer";
import { createElement, type ReactElement } from "react";
import {
  requireCapability,
  assertOrgId,
} from "@verifystack/backend/lib/auth/requireRole";
import { jsonError } from "@/lib/api";
import { getEngagement } from "@verifystack/backend/lib/data/engagements";
import { createServerSupabase } from "@verifystack/backend/lib/supabase/server";
import { createServiceClient } from "@verifystack/backend/lib/supabase/admin";
import { VerificationReportPdf } from "@verifystack/backend/domain/reports/VerificationReport";
import { AdeetieDprReportPdf } from "@verifystack/backend/domain/reports/AdeetieDprReport";
import { AdeetieIgeaReportPdf } from "@verifystack/backend/domain/reports/AdeetieIgeaReport";
import { AdeetieMvReportPdf } from "@verifystack/backend/domain/reports/AdeetieMvReport";
import type { CalcResult } from "@verifystack/backend/domain/calc/engine";
import {
  assessSavings,
  SEC_ENGINE_VERSION,
  type SecResult,
} from "@verifystack/backend/domain/calc/sec";
import {
  CLUSTERS_VERIFIED,
  computeSubvention,
  isAdeetieSector,
  isNotifiedCluster,
  MIN_ENERGY_SAVINGS_PCT,
  type EnterpriseCategory,
} from "@verifystack/backend/domain/packs/adeetie";
import {
  projectSavingsFromMeasures,
  signoffsForPass,
} from "@verifystack/backend/domain/adeetie/lifecycle";
import type { AdeetiePhase } from "@verifystack/backend/lib/supabase/types";

/**
 * Report kinds this route can render.
 *
 * `verification` is the CCTS GEI report and stays the default so existing links
 * keep working. `dpr` and `mv` are the ADEETIE documents, and both are working
 * papers rather than official BEE templates — the PDFs say so on their face.
 */
const REPORT_KINDS = ["verification", "igea", "dpr", "mv"] as const;
type ReportKind = (typeof REPORT_KINDS)[number];

function parseKind(raw: string | null): ReportKind {
  if (raw && (REPORT_KINDS as readonly string[]).includes(raw)) {
    return raw as ReportKind;
  }
  return "verification";
}

export async function GET(req: Request) {
  try {
    const session = await requireCapability("reports.download");
    const organizationId = assertOrgId(session.organizationId);
    const url = new URL(req.url);
    const engagementId = url.searchParams.get("engagementId");
    const kind = parseKind(url.searchParams.get("kind"));

    if (!engagementId) {
      return Response.json(
        { ok: false, error: "engagementId required" },
        { status: 400 }
      );
    }
    const engagement = await getEngagement(engagementId, organizationId);
    if (!engagement) {
      return Response.json({ ok: false, error: "Not found" }, { status: 404 });
    }

    const supabase = createServiceClient() ?? (await createServerSupabase());
    if (!supabase) {
      return Response.json(
        { ok: false, error: "Storage is not configured" },
        { status: 503 }
      );
    }

    const filenameId = engagement.id.slice(0, 8);

    if (kind === "verification") {
      const { data: run } = await supabase
        .from("calculation_runs")
        .select("*")
        .eq("engagement_id", engagement.id)
        .eq("method", "GEI")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const result = run?.result as CalcResult | undefined;
      return renderPdf(
        createElement(VerificationReportPdf, {
          clientName: engagement.client_name,
          plantName: engagement.plant_name,
          complianceYear: engagement.compliance_year,
          packId: engagement.pack_id,
          packVersion: engagement.pack_version,
          engineVersion: run?.engine_version ?? "n/a",
          inputHash: run?.input_hash ?? "no-run",
          draftMode: engagement.draft_mode,
          gei: result?.gei,
        }),
        `verifystack-${filenameId}.pdf`
      );
    }

    const [{ data: runs }, { data: measureRows }, { data: signoffRows }] = await Promise.all([
      supabase
        .from("calculation_runs")
        .select("*")
        .eq("engagement_id", engagement.id)
        .eq("method", "SEC")
        .order("created_at", { ascending: false }),
      supabase
        .from("adeetie_measures")
        .select("*")
        .eq("engagement_id", engagement.id)
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: true }),
      supabase
        .from("signoffs")
        .select("attestor_name, role, created_at, adeetie_phase")
        .eq("engagement_id", engagement.id)
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false }),
    ]);

    const rows = runs ?? [];
    const latest = (phase: string) =>
      rows.find((r) => (r as { sec_phase?: string }).sec_phase === phase) ??
      rows.find((r) => (r.result as Partial<SecResult> | null)?.phase === phase);

    const baselineRow = latest("baseline");
    const baseline = baselineRow?.result as SecResult | undefined;
    if (!baseline) {
      return Response.json(
        {
          ok: false,
          error:
            "No baseline SEC run exists for this engagement, so there is nothing to report.",
        },
        { status: 409 }
      );
    }

    const measures = (measureRows ?? []).map((m) => ({
      id: m.id,
      description: m.description,
      projectedAnnualSaving: Number(m.projected_annual_saving),
      savingUnit: m.saving_unit,
      capitalCostINR: Number(m.capital_cost_inr),
      basis: m.basis,
    }));

    const passPhase =
      kind === "mv" ? "MV" : kind === "dpr" ? "DPR" : ("IGEA" as AdeetiePhase);
    const passSignoff = signoffsForPass(signoffRows ?? [], passPhase)[0];
    const attestation = passSignoff
      ? {
          name: passSignoff.attestor_name,
          role: passSignoff.role,
          at: passSignoff.created_at,
        }
      : null;

    const sector = engagement.sector_or_cluster;
    const cluster = engagement.adeetie_cluster ?? "";
    const clusterIsNotified =
      isAdeetieSector(sector) && isNotifiedCluster(sector, cluster);

    const factorSetVersion = baselineRow?.factor_set_version ?? "n/a";
    const secEngineVersion =
      (baselineRow as { sec_engine_version?: string } | undefined)?.sec_engine_version ??
      SEC_ENGINE_VERSION;

    if (kind === "igea") {
      return renderPdf(
        createElement(AdeetieIgeaReportPdf, {
          enterpriseName: engagement.client_name,
          plantName: engagement.plant_name,
          sector,
          cluster,
          baseline,
          measures,
          packId: engagement.pack_id,
          packVersion: engagement.pack_version,
          secEngineVersion,
          factorSetVersion,
          draftMode: engagement.draft_mode,
          attestation,
        }),
        `verifystack-adeetie-igea-${filenameId}.pdf`
      );
    }

    if (kind === "dpr") {
      const category = (engagement.enterprise_category ??
        "Small") as EnterpriseCategory;
      const loanAmountINR = Number(engagement.loan_amount_inr ?? 0);
      const projectCostINR = Number(engagement.project_cost_inr ?? 0);
      let projectedPostSec: number | undefined;
      let projectedSavingsPct: number | undefined;
      if (measures.length > 0) {
        try {
          const p = projectSavingsFromMeasures(baseline.totalEnergy, measures);
          projectedSavingsPct = p.projectedSavingsPct;
          if (baseline.production.value > 0) {
            projectedPostSec = p.projectedPostEnergy / baseline.production.value;
          }
        } catch {
          projectedPostSec = undefined;
          projectedSavingsPct = undefined;
        }
      }

      return renderPdf(
        createElement(AdeetieDprReportPdf, {
          enterpriseName: engagement.client_name,
          plantName: engagement.plant_name,
          sector,
          cluster,
          state: engagement.adeetie_state ?? "",
          clusterIsNotified,
          clusterListVerified: CLUSTERS_VERIFIED,
          category,
          udyamRegistrationNo: engagement.udyam_registration_no,
          baseline,
          measures,
          projectedPostSec,
          projectedSavingsPct,
          minSavingsPct: MIN_ENERGY_SAVINGS_PCT,
          projectCostINR,
          loanAmountINR,
          subvention: computeSubvention({
            category,
            sanctionedRatePct: Number(
              engagement.sanctioned_interest_rate_pct ?? 0
            ),
            principalINR: loanAmountINR,
          }),
          packId: engagement.pack_id,
          packVersion: engagement.pack_version,
          secEngineVersion,
          factorSetVersion,
          draftMode: engagement.draft_mode,
          attestation,
        }),
        `verifystack-adeetie-dpr-${filenameId}.pdf`
      );
    }

    const post = latest("post_implementation")?.result as SecResult | undefined;
    if (!post) {
      return Response.json(
        {
          ok: false,
          error:
            "No post-implementation SEC run exists, so no savings can be verified yet.",
        },
        { status: 409 }
      );
    }

    return renderPdf(
      createElement(AdeetieMvReportPdf, {
        enterpriseName: engagement.client_name,
        plantName: engagement.plant_name,
        sector,
        cluster,
        baseline,
        post,
        savings: assessSavings(baseline, post),
        commissionedOn: null,
        sustainedPeriodsObserved: rows.filter((r) => {
          const col = (r as { sec_phase?: string }).sec_phase;
          return (
            col === "post_implementation" ||
            (r.result as Partial<SecResult> | null)?.phase === "post_implementation"
          );
        }).length,
        packId: engagement.pack_id,
        packVersion: engagement.pack_version,
        secEngineVersion,
        factorSetVersion,
        draftMode: engagement.draft_mode,
        attestation,
      }),
      `verifystack-adeetie-mv-${filenameId}.pdf`
    );
  } catch (e) {
    return jsonError(e);
  }
}

async function renderPdf(doc: ReactElement, filename: string): Promise<Response> {
  const buf = await renderToBuffer(doc as ReactElement<DocumentProps>);
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
