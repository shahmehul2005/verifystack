import { notFound } from "next/navigation";
import { ConfigureSupabase, ForbiddenState } from "@/components/states";
import { PageHeader, DraftBanner } from "@/components/page-header";
import { DraftModeToggle } from "@/components/draft-mode-toggle";
import { Table, Td, Th } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { SecRunView } from "@/components/adeetie/sec-run-view";
import {
  ADEETIE_MIN_SAVINGS_PCT,
  pickSecRuns,
  safeAssessSavings,
  type RunRow,
} from "@/components/adeetie/sec";
import { getSession } from "@verifystack/backend/lib/auth/getSession";
import { hasCapability } from "@verifystack/backend/lib/auth/capabilities";
import { isSupabaseConfigured } from "@verifystack/backend/lib/supabase/configured";
import { getEngagement } from "@verifystack/backend/lib/data/engagements";
import { createServerSupabase } from "@verifystack/backend/lib/supabase/server";
import { createServiceClient } from "@verifystack/backend/lib/supabase/admin";
import { loadPack, canStartWork } from "@verifystack/backend/domain/packs";
import { canSeedAdeetiePack } from "@verifystack/backend/demo/adeetieFacts";
import { assessRunReadiness, type ProvenancedFact, type RunReadiness } from "@verifystack/backend/domain/calc/run";
import {
  allowedSecPhases,
  filterFactsForSecPhase,
} from "@verifystack/backend/domain/adeetie/lifecycle";
import { isAdeetiePhase } from "@verifystack/backend/domain/packs/adeetie/phases";
import type { AdeetiePhase } from "@verifystack/backend/lib/supabase/types";
import { formatIn, formatIst } from "@/lib/format";
import { RunCalcButton } from "./run-button";
import { SeedDemoFactsButton } from "../facts/seed-demo-button";
import type { CalcResult } from "@verifystack/backend/domain/calc/engine";

export default async function RunsPage({ params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured()) return <ConfigureSupabase />;
  const { id } = await params;
  const session = await getSession();
  if (!session?.organizationId) return <ForbiddenState />;
  if (!hasCapability(session.role, "runs.view")) {
    return <ForbiddenState body="Calculation runs (P5) are not part of this role." />;
  }
  const canRun = hasCapability(session.role, "runs.execute");
  const canDraft = hasCapability(session.role, "engagements.draftMode");
  const canSeed = hasCapability(session.role, "engagements.create");
  const engagement = await getEngagement(id, session.organizationId);
  if (!engagement) notFound();
  const pack = loadPack(engagement.pack_id);
  const runnable = canStartWork(pack);
  const isSec = pack.calculation_method === "SEC";
  const seedableAdeetie = canSeedAdeetiePack(pack);
  const seedLabel = seedableAdeetie
    ? "Load synthetic ADEETIE facts"
    : "Load Aravalli synthetic facts";
  const seedable = engagement.pack_id === "CCTS-CEMENT-v1" || seedableAdeetie;

  const supabase = createServiceClient() ?? (await createServerSupabase());
  const [{ data: runs }, { data: factRows }, { data: docs }] = await Promise.all([
    supabase!
      .from("calculation_runs")
      .select("*")
      .eq("engagement_id", id)
      .eq("organization_id", session.organizationId)
      .order("created_at", { ascending: false }),
    supabase!
      .from("facts")
      .select("id, field_path, value_json, unit, document_id, page, bbox, source_text")
      .eq("engagement_id", id)
      .eq("organization_id", session.organizationId),
    supabase!
      .from("documents")
      .select("id, adeetie_phase")
      .eq("engagement_id", id)
      .eq("organization_id", session.organizationId),
  ]);

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
  const rawPhase = engagement.adeetie_phase;
  const adeetiePhase =
    engagement.scheme === "ADEETIE" && rawPhase && isAdeetiePhase(rawPhase)
      ? rawPhase
      : null;
  const secPhases = isSec && adeetiePhase ? allowedSecPhases(adeetiePhase) : undefined;
  const factsForReadiness =
    isSec && adeetiePhase
      ? filterFactsForSecPhase(
          facts,
          new Map(
            (docs ?? []).map((d) => [d.id, (d.adeetie_phase ?? null) as AdeetiePhase | null])
          ),
          secPhases![0]!
        )
      : facts;
  const readiness = assessRunReadiness(pack, factsForReadiness, {
    draftMode: engagement.draft_mode,
  });

  const rows = (runs ?? []) as RunRow[];
  const secSet = pickSecRuns(rows);
  const thresholdPct = pack.sec_config?.minSavingsPct ?? ADEETIE_MIN_SAVINGS_PCT;
  const savings = safeAssessSavings(secSet, thresholdPct);
  const latestGei = !isSec ? (rows[0]?.result as CalcResult | undefined) : undefined;

  return (
    <>
      <PageHeader
        kicker="P5 / D5"
        title={isSec ? "Specific energy consumption runs" : "Calculation runs"}
        description={
          isSec
            ? "Energy in, output out, one intensity figure. Engine version + pack version + factor set + input hash, hash-chained."
            : "Engine version + pack version + input hash. Hash-chained."
        }
        actions={
          runnable && (canRun || canSeed) ? (
            <div className="flex flex-wrap gap-2">
              {canSeed && engagement.draft_mode && seedable ? (
                <SeedDemoFactsButton engagementId={id} label={seedLabel} />
              ) : null}
              {canRun ? (
                <RunCalcButton
                  engagementId={id}
                  method={isSec ? "SEC" : "GEI"}
                  allowedSecPhases={secPhases}
                />
              ) : null}
            </div>
          ) : runnable ? undefined : (
            <Badge tone="draft">Scaffold — runs disabled</Badge>
          )
        }
      />
      <DraftBanner show={engagement.draft_mode} />
      {canDraft ? (
        <div className="mb-4">
          <DraftModeToggle engagementId={id} draftMode={engagement.draft_mode} />
        </div>
      ) : null}

      {isSec ? (
        <>
          <SecRunView set={secSet} savings={savings} thresholdPct={thresholdPct} />
          {!rows.length || !readiness.canRun ? (
            <div className="mt-6">
              <RunReadyState
                readiness={readiness}
                draftMode={engagement.draft_mode}
                engagementId={id}
                method="SEC"
                allowedSecPhases={secPhases}
                canExecute={canRun}
              />
            </div>
          ) : null}
        </>
      ) : (
        <>
          {latestGei ? (
            <div className="mb-6 grid gap-2 sm:grid-cols-3">
              <Stat label="GEI" value={latestGei.gei.toFixed(6)} />
              <Stat
                label="Scope 1"
                value={`${formatIn(latestGei.scope1.value / 1000)} tCO₂e`}
              />
              <Stat
                label="Scope 2"
                value={`${formatIn(latestGei.scope2.value / 1000)} tCO₂e`}
              />
            </div>
          ) : null}
          {!rows.length ? (
            <RunReadyState
              readiness={readiness}
              draftMode={engagement.draft_mode}
              engagementId={id}
              method="GEI"
              canExecute={canRun}
            />
          ) : null}
        </>
      )}

      {rows.length ? (
        <section className="mt-8">
          <h2 className="mb-2 text-[11px] uppercase tracking-wide text-stone-500">Run ledger</h2>
          <Table>
            <thead>
              <tr>
                <Th>Input hash</Th>
                <Th>Engine</Th>
                <Th>Pack</Th>
                <Th>Factor set</Th>
                <Th>Draft</Th>
                <Th>When (IST)</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <Td className="font-mono text-[11px]">{r.input_hash.slice(0, 16)}…</Td>
                  <Td>{r.engine_version}</Td>
                  <Td className="font-mono text-[11px]">
                    {r.pack_id}@{r.pack_version}
                  </Td>
                  <Td className="font-mono text-[11px]">{r.factor_set_version}</Td>
                  <Td>{r.draft_mode ? "yes" : "no"}</Td>
                  <Td className="text-[12px]">{formatIst(r.created_at)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </section>
      ) : null}
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-stone-200 bg-white p-3">
      <p className="text-[11px] uppercase tracking-wide text-stone-500">{label}</p>
      <p className="font-mono text-lg tabular">{value}</p>
    </div>
  );
}

function RunReadyState({
  readiness,
  draftMode,
  engagementId,
  method,
  allowedSecPhases,
  canExecute,
}: {
  readiness: RunReadiness;
  draftMode: boolean;
  engagementId: string;
  method: "GEI" | "SEC";
  allowedSecPhases?: Array<"baseline" | "post_implementation">;
  canExecute: boolean;
}) {
  return (
    <div className="border border-stone-200 bg-white p-5">
      <h2 className="text-sm font-semibold text-stone-900">
        {readiness.canRun ? "Ready to run" : "Cannot run yet"}
      </h2>
      <p className="mt-1 text-sm text-stone-600">
        {readiness.factCount} D4 fact{readiness.factCount === 1 ? "" : "s"} committed.
        {draftMode
          ? " Draft mode is on, so unverified factors are allowed."
          : " Draft mode is off — unverified factors will be refused."}
      </p>
      {readiness.productionPath ? (
        <p className="mt-2 font-mono text-[12px] text-stone-600">
          production ({readiness.productionPath}): {readiness.productionBound ? "bound" : "missing"}
        </p>
      ) : null}
      <ul className="mt-2 space-y-1 text-[12px] text-stone-600">
        {readiness.streams.map((s) => (
          <li key={s.streamId} className="font-mono">
            {s.bound ? "bound" : "skipped"} {s.streamId}
            {s.reason ? ` — ${s.reason}` : ""}
          </li>
        ))}
      </ul>
      {readiness.warnings.length ? (
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-amber-800">
          {readiness.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : null}
      {readiness.blockers.length ? (
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-red-800">
          {readiness.blockers.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-stone-700">
          Click <span className="font-medium">Run calculation</span> to write a hash-chained run.
        </p>
      )}
      {canExecute ? (
        <div className="mt-4">
          <RunCalcButton
            engagementId={engagementId}
            method={method}
            allowedSecPhases={allowedSecPhases}
          />
        </div>
      ) : (
        <p className="mt-4 text-[12px] text-stone-500">
          Running the engine (P5) is restricted to the lead verifier.
        </p>
      )}
    </div>
  );
}
