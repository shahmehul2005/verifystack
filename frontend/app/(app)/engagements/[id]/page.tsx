import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowRight,
  BookOpen,
  Calculator,
  ClipboardList,
  FileText,
  Flag,
  Lightbulb,
  ListChecks,
  MapPin,
  Package,
  PenLine,
  ShieldCheck,
  Upload,
  type LucideIcon,
} from "lucide-react";
import { ConfigureSupabase, EmptyState, ForbiddenState } from "@/components/states";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Card, CardBody, SectionTitle } from "@/components/ui/card";
import { Stepper } from "@/components/ui/stepper";
import { AdeetiePhasePanel } from "@/components/adeetie/phase-panel";
import { AdeetieReportLinks } from "@/components/adeetie/report-links";
import { AdvancePhaseButton } from "@/components/adeetie/advance-phase-button";
import { MeasuresPanel, type MeasureRow } from "@/components/adeetie/measures-panel";
import { DprFinanceForm } from "@/components/adeetie/dpr-finance-form";
import { SavingsPanel, type SavingsRunView } from "@/components/adeetie/savings-panel";
import {
  ADEETIE_MIN_SAVINGS_PCT,
  pickSecRuns,
  safeAssessSavings,
  type RunRow,
} from "@/components/adeetie/sec";
import { getSession } from "@verifystack/backend/lib/auth/getSession";
import { hasCapability, engagementLinksForRole } from "@verifystack/backend/lib/auth/capabilities";
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
import { suggestEcmsForEngagement } from "@verifystack/backend/lib/data/ecm";
import { EcmSuggestions } from "@/components/ecm/suggestions";
import { formatIst } from "@/lib/format";
import { StageTracker, type StageEventRow } from "@/components/engagement/stage-tracker";
import { stagePhaseMismatch } from "@verifystack/backend/domain/stages/stages";

const NEXT_SECTION: Record<Status, string | null> = {
  setup: "documents",
  intake: "documents",
  review: "workbench",
  calc: "runs",
  findings: "findings",
  signoff: "signoff",
  submitted: null,
};

const SECTION_COPY: Record<string, { icon: LucideIcon; body: string; next: string }> = {
  documents: {
    icon: FileText,
    body: "Upload bills, invoices and logs; run extraction.",
    next: "upload and extract the plant's evidence.",
  },
  workbench: {
    icon: ListChecks,
    body: "Check each extracted value against its source page.",
    next: "review extracted values against the evidence.",
  },
  facts: {
    icon: BookOpen,
    body: "Accepted values with their provenance.",
    next: "check the accepted facts.",
  },
  runs: {
    icon: Calculator,
    body: "Run the versioned calculation engine.",
    next: "run the calculation.",
  },
  findings: {
    icon: Flag,
    body: "Reconciliation findings, citations and CAR drafts.",
    next: "resolve findings before sign-off.",
  },
  ecm: {
    icon: Lightbulb,
    body: "Measures matched from the ECM library.",
    next: "review suggested measures.",
  },
  signoff: {
    icon: PenLine,
    body: "Lead verifier, then an independent reviewer.",
    next: "complete both sign-offs.",
  },
  plan: {
    icon: ClipboardList,
    body: "Risk ratings, sampling rate and the verification plan.",
    next: "approve the verification plan.",
  },
  fieldwork: {
    icon: MapPin,
    body: "Site visits and observations captured on the day.",
    next: "record the site visit.",
  },
  "technical-review": {
    icon: ShieldCheck,
    body: "The independent reviewer's approval before sign-off.",
    next: "record the technical review.",
  },
  package: {
    icon: Package,
    body: "Everything to hand over, in one verifiable ZIP.",
    next: "download the submission package.",
  },
};

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

  /**
   * The lifecycle panels expose calculation results, costed measures and loan
   * figures — P5 to P7 material. Firm administration does not carry those
   * capabilities, so the queries behind them are skipped rather than rendered
   * and hidden.
   */
  const canViewAdeetie = isAdeetie && hasCapability(session.role, "adeetie.view");

  let secSet = pickSecRuns([]);
  let measures: MeasureRow[] = [];
  let blockers: string[] = [];
  let missingLifecycleTable = false;
  if (canViewAdeetie) {
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
  let savingsRun: SavingsRunView | null = null;
  if (canViewAdeetie) {
    const sb = createServiceClient() ?? (await createServerSupabase());
    const { data: sr } = await sb!
      .from("savings_dpr_runs")
      .select("input_hash, result, created_at")
      .eq("engagement_id", id)
      .eq("organization_id", session.organizationId)
      .order("created_at", { ascending: false })
      .limit(1);
    const row = sr?.[0];
    if (row) {
      savingsRun = {
        inputHash: row.input_hash,
        createdAt: row.created_at,
        result: row.result as unknown as SavingsRunView["result"],
      };
    }
  }
  let stageEvents: StageEventRow[] = [];
  if (canViewAdeetie && pack.stages?.length) {
    const sb = createServiceClient() ?? (await createServerSupabase());
    const { data: evs } = await sb!
      .from("engagement_stage_events")
      .select("*")
      .eq("engagement_id", id)
      .eq("organization_id", session.organizationId)
      .order("created_at", { ascending: false })
      .limit(5);
    stageEvents = (evs ?? []).map((e) => ({
      id: e.id,
      from: e.from_stage,
      to: e.to_stage,
      direction: e.direction,
      note: e.note,
      at: formatIst(e.created_at, false),
    }));
  }
  const savings = safeAssessSavings(
    secSet,
    pack.sec_config?.minSavingsPct ?? ADEETIE_MIN_SAVINGS_PCT
  );
  const nextPhase = isAdeetie ? nextAdeetiePhase(phase) : null;
  const savingUnit = pack.sec_config?.reportingEnergyUnit ?? "GJ";
  const financeLocked = phase === "MV" || !hasCapability(session.role, "adeetie.operate");
  const canOperateAdeetie = hasCapability(session.role, "adeetie.operate");
  const canViewEcm = hasCapability(session.role, "adeetie.view");
  const ecmPayload = canViewEcm
    ? await suggestEcmsForEngagement(id, session.organizationId, { style: false })
    : null;
  const tiles = engagementLinksForRole(session.role);

  const status = engagement.status as Status;
  const nextSlug = NEXT_SECTION[status];
  const nextTile = nextSlug ? tiles.find((t) => t.slug === nextSlug) : undefined;

  return (
    <>
      <PageHeader
        kicker={`${engagement.scheme} · ${engagement.sector_or_cluster}`}
        title={engagement.client_name}
        description={[engagement.plant_name, `Compliance year ${engagement.compliance_year}`]
          .filter(Boolean)
          .join(" · ")}
        meta={
          <>
            <Badge tone={status === "submitted" ? "ok" : "ink"} dot>
              {STATUS_LABEL[engagement.status]}
            </Badge>
            <span className="text-xs text-mist-500">
              Pack <span className="font-mono">{engagement.pack_id}</span> v{engagement.pack_version}
            </span>
            <span aria-hidden className="text-mist-300">·</span>
            <span className="text-xs text-mist-500">Opened {formatIst(engagement.created_at)}</span>
          </>
        }
        actions={
          runnable && hasCapability(session.role, "documents.upload") ? (
            <Link href={`/engagements/${id}/documents`} className={buttonVariants()}>
              <Upload />
              Open intake
            </Link>
          ) : !runnable ? (
            <Badge tone="draft">Not yet available for this pack</Badge>
          ) : undefined
        }
      />
      {missingLifecycleTable ? (
        <Alert tone="warn" title="Database update needed" className="mb-6">
          Run <span className="font-mono">backend/supabase/migrations/0008_adeetie_lifecycle.sql</span>{" "}
          in the Supabase SQL editor. IGEA → DPR → M&amp;V measures, per-pass sign-off and evidence
          tagging need that table.
        </Alert>
      ) : null}
      {!runnable ? (
        <div className="mb-6">
          <EmptyState
            title="This pack is not runnable yet"
            body="You can keep this engagement in setup. Intake, extraction and calculation open once the methodology pack is complete."
          />
        </div>
      ) : null}

      <Card className="mb-6">
        <CardBody className="px-4 py-6 sm:px-8">
          <Stepper
            label="Engagement progress"
            current={status}
            steps={ENGAGEMENT_STATUSES.map((s) => ({ id: s, label: STATUS_LABEL[s] }))}
          />
        </CardBody>
        {nextTile && runnable ? (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-mist-100 bg-teal-50/40 px-5 py-3.5">
            <p className="text-sm text-mist-700">
              <span className="font-medium text-mist-900">Next: </span>
              {SECTION_COPY[nextTile.slug]?.next ?? nextTile.label}
            </p>
            <Link
              href={`/engagements/${id}/${nextTile.slug}`}
              className={buttonVariants({ size: "sm" })}
            >
              Go to {nextTile.label.toLowerCase()}
              <ArrowRight />
            </Link>
          </div>
        ) : null}
      </Card>

      {canViewAdeetie && pack.stages && pack.stages.length > 0 ? (
        <StageTracker
          engagementId={id}
          stages={pack.stages.map((s) => ({ id: s.id, label: s.label }))}
          current={engagement.stage ?? null}
          canMove={hasCapability(session.role, "engagements.stage")}
          mismatch={stagePhaseMismatch(pack.stages, engagement.stage ?? null, phase)}
          events={stageEvents}
        />
      ) : null}

      {canViewAdeetie ? (
        <AdeetiePhasePanel
          position={position}
          savings={savings}
          thresholdPct={pack.sec_config?.minSavingsPct ?? ADEETIE_MIN_SAVINGS_PCT}
          actions={
            nextPhase && canOperateAdeetie ? (
              <AdvancePhaseButton
                engagementId={id}
                nextPhase={nextPhase}
                blockers={blockers}
              />
            ) : null
          }
        />
      ) : null}

      {canViewAdeetie ? (
        <>
          <MeasuresPanel
            engagementId={id}
            measures={measures}
            savingUnit={savingUnit}
            locked={financeLocked}
          />
          <SavingsPanel
            engagementId={id}
            latest={savingsRun}
            canRun={canOperateAdeetie}
            hasMeasures={measures.length > 0}
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

      {ecmPayload ? (
        <section className="mb-8">
          <SectionTitle>Energy conservation measure suggestions</SectionTitle>
          <EcmSuggestions payload={ecmPayload} />
        </section>
      ) : null}

      {tiles.length > 0 ? (
        <section>
          <SectionTitle>Sections</SectionTitle>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {tiles.map((item) => {
              const copy = SECTION_COPY[item.slug];
              const Icon = copy?.icon ?? FileText;
              return (
                <Link
                  key={item.slug}
                  href={`/engagements/${id}/${item.slug}`}
                  className="group flex gap-3 rounded-lg border border-mist-200 bg-white p-4 shadow-xs transition-colors hover:border-teal-300 hover:bg-teal-50/30"
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-teal-50 text-teal-700 group-hover:bg-teal-100">
                    <Icon className="size-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-mist-900">{item.label}</span>
                    {copy ? (
                      <span className="mt-0.5 block text-[13px] leading-snug text-mist-600">
                        {copy.body}
                      </span>
                    ) : null}
                  </span>
                </Link>
              );
            })}
          </div>
        </section>
      ) : null}

      {canViewAdeetie && hasCapability(session.role, "reports.download") ? (
        <section className="mt-8">
          <SectionTitle>Reports</SectionTitle>
          <AdeetieReportLinks engagementId={id} />
        </section>
      ) : null}
    </>
  );
}
