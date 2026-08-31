import Link from "next/link";
import { notFound } from "next/navigation";
import { ConfigureSupabase, EmptyState, ForbiddenState } from "@/components/states";
import { PageHeader, DraftBanner } from "@/components/page-header";
import { DraftModeToggle } from "@/components/draft-mode-toggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AdeetiePhasePanel } from "@/components/adeetie/phase-panel";
import { AdeetieReportLinks } from "@/components/adeetie/report-links";
import { AdvancePhaseButton } from "@/components/adeetie/advance-phase-button";
import { MeasuresPanel, type MeasureRow } from "@/components/adeetie/measures-panel";
import { DprFinanceForm } from "@/components/adeetie/dpr-finance-form";
import {
  ADEETIE_MIN_SAVINGS_PCT,
  pickSecRuns,
  safeAssessSavings,
  type RunRow,
} from "@/components/adeetie/sec";
import { getSession } from "@verifystack/backend/lib/auth/getSession";
import { isSupabaseConfigured } from "@verifystack/backend/lib/supabase/configured";
import { getEngagement } from "@verifystack/backend/lib/data/engagements";
import { createServerSupabase } from "@verifystack/backend/lib/supabase/server";
import { createServiceClient } from "@verifystack/backend/lib/supabase/admin";
import { loadPack, canStartWork } from "@verifystack/backend/domain/packs";
import {
  STATUS_LABEL,
  ENGAGEMENT_STATUSES,
  nextAdeetiePhase,
  type AdeetiePhase,
  type Status,
} from "@verifystack/backend/domain/engagements/status";
import {
  phaseAdvanceBlockers,
  projectSavingsFromMeasures,
} from "@verifystack/backend/domain/adeetie/lifecycle";
import { MIN_ENERGY_SAVINGS_PCT } from "@verifystack/backend/domain/packs/adeetie";
import { openBlockFindings } from "@verifystack/backend/domain/signoff/guards";
import { formatIst } from "@/lib/format";

const LINKS = [
  ["documents", "Documents"],
  ["workbench", "Workbench"],
  ["facts", "Facts ledger"],
  ["runs", "Calculation"],
  ["findings", "Findings"],
  ["signoff", "Sign-off"],
] as const;

function readPhase(engagement: unknown): AdeetiePhase {
  const value = (engagement as { adeetie_phase?: unknown }).adeetie_phase;
  return value === "DPR" || value === "MV" ? value : "IGEA";
}

export default async function EngagementHome({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!isSupabaseConfigured()) return <ConfigureSupabase />;
  const { id } = await params;
  const session = await getSession();
  if (!session?.organizationId) return <ForbiddenState />;
  const engagement = await getEngagement(id, session.organizationId);
  if (!engagement) notFound();
  const pack = loadPack(engagement.pack_id);
  const runnable = canStartWork(pack);
  const isAdeetie = engagement.scheme === "ADEETIE";
  const phase = readPhase(engagement);
  const position = { status: engagement.status as Status, phase };

  let secSet = pickSecRuns([]);
  let measures: MeasureRow[] = [];
  let blockers: string[] = [];
  let missingLifecycleTable = false;
  if (isAdeetie) {
    const supabase = createServiceClient() ?? (await createServerSupabase());
    const [{ data: runs }, measuresRes, { data: findings }] = await Promise.all([
      supabase!
        .from("calculation_runs")
        .select("*")
        .eq("engagement_id", id)
        .eq("organization_id", session.organizationId)
        .order("created_at", { ascending: false }),
      supabase!
        .from("adeetie_measures")
        .select("*")
        .eq("engagement_id", id)
        .eq("organization_id", session.organizationId)
        .order("created_at", { ascending: true }),
      supabase!
        .from("findings")
        .select("id, severity, state")
        .eq("engagement_id", id)
        .eq("organization_id", session.organizationId),
    ]);
    const measureRows = measuresRes.error ? [] : (measuresRes.data ?? []);
    missingLifecycleTable = Boolean(measuresRes.error);
    secSet = pickSecRuns((runs ?? []) as RunRow[]);
    measures = (measureRows ?? []) as MeasureRow[];

    let projected = null;
    const baseline = secSet.baseline?.result;
    if (baseline && measures.length > 0) {
      try {
        projected = projectSavingsFromMeasures(
          baseline.totalEnergy,
          measures.map((m) => ({
            projectedAnnualSaving: Number(m.projected_annual_saving),
            savingUnit: m.saving_unit,
          })),
          pack.sec_config?.minSavingsPct ?? MIN_ENERGY_SAVINGS_PCT
        );
      } catch {
        projected = null;
      }
    }
    blockers = phaseAdvanceBlockers({
      position,
      hasBaselineSec: Boolean(secSet.baseline) ||
        (runs ?? []).some((r) => (r as { sec_phase?: string }).sec_phase === "baseline"),
      openBlockCount: openBlockFindings(findings ?? []).length,
      measureCount: measures.length,
      loanAmountINR: engagement.loan_amount_inr,
      projectCostINR: engagement.project_cost_inr,
      projected,
    });
  }
  const savings = safeAssessSavings(
    secSet,
    pack.sec_config?.minSavingsPct ?? ADEETIE_MIN_SAVINGS_PCT
  );
  const nextPhase = isAdeetie ? nextAdeetiePhase(phase) : null;
  const savingUnit = pack.sec_config?.reportingEnergyUnit ?? "GJ";
  const financeLocked = phase === "MV";

  return (
    <>
      <PageHeader
        kicker={`${engagement.scheme} · ${engagement.sector_or_cluster}`}
        title={engagement.client_name}
        description={`${engagement.plant_name ?? "—"} · ${engagement.compliance_year} · pack ${engagement.pack_id} v${engagement.pack_version}`}
        actions={
          runnable ? (
            <Link href={`/engagements/${id}/documents`}>
              <Button>Open intake</Button>
            </Link>
          ) : (
            <Badge tone="draft">Scaffold — start work disabled</Badge>
          )
        }
      />
      <DraftBanner show={engagement.draft_mode} />
      <div className="mb-4">
        <DraftModeToggle engagementId={id} draftMode={engagement.draft_mode} />
      </div>
      {missingLifecycleTable ? (
        <p className="mb-4 border border-amber-300 bg-amber-50 px-3 py-2 text-[13px] text-amber-950">
          Run <span className="font-mono">backend/supabase/migrations/0008_adeetie_lifecycle.sql</span>{" "}
          in the Supabase SQL editor. IGEA → DPR → M&amp;V measures, per-pass sign-off, and
          evidence tagging need that table.
        </p>
      ) : null}
      <div className="mb-6 flex flex-wrap items-center gap-2 text-[12px] text-stone-600">
        <Badge>{STATUS_LABEL[engagement.status]}</Badge>
        <span>Opened {formatIst(engagement.created_at)}</span>
      </div>
      {!runnable ? (
        <EmptyState
          title="Pack is scaffold only"
          body="You can keep this engagement in setup. Active intake, extraction, and calculation stay disabled until the pack is runnable."
        />
      ) : null}
      <ol className="mb-8 flex flex-wrap gap-1 text-[11px] uppercase tracking-wide text-stone-500">
        {ENGAGEMENT_STATUSES.map((s) => (
          <li
            key={s}
            className={
              s === engagement.status
                ? "bg-stone-900 px-2 py-1 text-white"
                : "bg-white px-2 py-1 ring-1 ring-stone-200"
            }
          >
            {STATUS_LABEL[s]}
          </li>
        ))}
      </ol>

      {isAdeetie ? (
        <AdeetiePhasePanel
          position={position}
          savings={savings}
          thresholdPct={pack.sec_config?.minSavingsPct ?? ADEETIE_MIN_SAVINGS_PCT}
          actions={
            nextPhase ? (
              <AdvancePhaseButton
                engagementId={id}
                nextPhase={nextPhase}
                blockers={blockers}
              />
            ) : null
          }
        />
      ) : null}

      {isAdeetie ? (
        <>
          <MeasuresPanel
            engagementId={id}
            measures={measures}
            savingUnit={savingUnit}
            locked={financeLocked}
          />
          <DprFinanceForm
            engagementId={id}
            loanAmountInr={engagement.loan_amount_inr}
            projectCostInr={engagement.project_cost_inr}
            sanctionedInterestRatePct={engagement.sanctioned_interest_rate_pct}
            locked={financeLocked}
          />
        </>
      ) : null}

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {LINKS.map(([slug, label]) => (
          <Link
            key={slug}
            href={`/engagements/${id}/${slug}`}
            className="border border-stone-200 bg-white px-4 py-3 text-sm hover:border-stone-400"
          >
            {label}
          </Link>
        ))}
      </div>

      {isAdeetie ? (
        <section className="mt-8">
          <h2 className="mb-2 text-[11px] uppercase tracking-wide text-stone-500">Reports</h2>
          <AdeetieReportLinks engagementId={id} />
        </section>
      ) : null}
    </>
  );
}
