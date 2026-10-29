import { notFound } from "next/navigation";
import { CircleCheck, CircleDashed } from "lucide-react";
import { ConfigureSupabase, ForbiddenState } from "@/components/states";
import { PageHeader } from "@/components/page-header";
import { Table, Td, Th } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { Card, CardBody, CardHeader, SectionTitle } from "@/components/ui/card";
import { CopyText } from "@/components/ui/copy-text";
import { SecRunView } from "@/components/adeetie/sec-run-view";
import { GeiRunView } from "@/components/ccts/gei-run-view";
import {
  ADEETIE_MIN_SAVINGS_PCT,
  pickSecRuns,
  safeAssessSavings,
  type RunRow,
} from "@/components/adeetie/sec";
import { getSession } from "@/lib/session";
import { hasCapability } from "@verifystack/backend/lib/auth/capabilities";
import { isSupabaseConfigured } from "@verifystack/backend/lib/supabase/configured";
import { getEngagement } from "@/lib/session";
import { createServerSupabase } from "@verifystack/backend/lib/supabase/server";
import { createServiceClient } from "@verifystack/backend/lib/supabase/admin";
import { loadPack, canStartWork } from "@verifystack/backend/domain/packs";
import { assessRunReadiness, toProvenancedFact, type ProvenancedFact, type RunReadiness } from "@verifystack/backend/domain/calc/run";
import {
  allowedSecPhases,
  filterFactsForSecPhase,
} from "@verifystack/backend/domain/adeetie/lifecycle";
import { isAdeetiePhase } from "@verifystack/backend/domain/packs/adeetie/phases";
import type { AdeetiePhase } from "@verifystack/backend/lib/supabase/types";
import { formatIst } from "@/lib/format";
import { RunCalcButton } from "./run-button";
import type { CalcResult } from "@verifystack/backend/domain/calc/engine";

export const metadata = { title: "Calculation" };

export default async function RunsPage({ params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured()) return <ConfigureSupabase />;
  const { id } = await params;
  const session = await getSession();
  if (!session?.organizationId) return <ForbiddenState />;
  if (!hasCapability(session.role, "runs.view")) {
    return <ForbiddenState body="Calculation results are for verifiers, the lead verifier and reviewers." />;
  }
  const canRun = hasCapability(session.role, "runs.execute");
  const engagement = await getEngagement(id, session.organizationId);
  if (!engagement) notFound();
  const pack = loadPack(engagement.pack_id);
  const runnable = canStartWork(pack);
  const isSec = pack.calculation_method === "SEC";

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
      .select(
        "id, field_path, value_json, unit, document_id, page, bbox, source_text, provenance_type, provenance"
      )
      .eq("engagement_id", id)
      .eq("organization_id", session.organizationId),
    supabase!
      .from("documents")
      .select("id, adeetie_phase")
      .eq("engagement_id", id)
      .eq("organization_id", session.organizationId),
  ]);

  const facts: ProvenancedFact[] = (factRows ?? []).map(toProvenancedFact);
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
        title={isSec ? "Specific energy consumption" : "Calculation"}
        description={
          isSec
            ? "Energy in, output out, one intensity figure. Each run records the engine, pack and factor-set versions and a fingerprint of its inputs, chained to the run before it."
            : "Each run records the engine and pack versions and a fingerprint of its inputs, chained to the run before it, so any result can be reproduced."
        }
        actions={
          runnable && canRun ? (
            <RunCalcButton
              engagementId={id}
              method={isSec ? "SEC" : "GEI"}
              allowedSecPhases={secPhases}
            />
          ) : runnable ? undefined : (
            <Badge tone="draft">Not yet available for this pack</Badge>
          )
        }
      />

      {isSec ? (
        <>
          <SecRunView set={secSet} savings={savings} thresholdPct={thresholdPct} />
          {!rows.length || !readiness.canRun ? (
            <div className="mt-6">
              <RunReadyState
                readiness={readiness}
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
            <div className="mb-8">
              <GeiRunView result={latestGei} facts={facts} engagementId={id} />
            </div>
          ) : null}
          {!rows.length ? (
            <RunReadyState
              readiness={readiness}
              engagementId={id}
              method="GEI"
              canExecute={canRun}
            />
          ) : null}
        </>
      )}

      {rows.length ? (
        <section className="mt-8">
          <SectionTitle>Run history</SectionTitle>
          <Table>
            <thead>
              <tr>
                <Th>Input fingerprint</Th>
                <Th>Engine</Th>
                <Th>Pack</Th>
                <Th>Factor set</Th>
                <Th>Run at (IST)</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id}>
                  <Td>
                    <span className="flex items-center gap-2">
                      <CopyText value={r.input_hash} />
                      {i === 0 ? <Badge tone="ink">Latest</Badge> : null}
                    </span>
                  </Td>
                  <Td className="font-mono text-xs">{r.engine_version}</Td>
                  <Td className="font-mono text-xs">
                    {r.pack_id}@{r.pack_version}
                  </Td>
                  <Td className="font-mono text-xs">{r.factor_set_version}</Td>
                  <Td className="whitespace-nowrap text-xs text-mist-600">{formatIst(r.created_at)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </section>
      ) : null}
    </>
  );
}

function RunReadyState({
  readiness,
  engagementId,
  method,
  allowedSecPhases,
  canExecute,
}: {
  readiness: RunReadiness;
  engagementId: string;
  method: "GEI" | "SEC";
  allowedSecPhases?: Array<"baseline" | "post_implementation">;
  canExecute: boolean;
}) {
  return (
    <Card>
      <CardHeader
        title={readiness.canRun ? "Ready to run" : "Not ready to run yet"}
        description={`${readiness.factCount} accepted ${readiness.factCount === 1 ? "fact" : "facts"} in the ledger.`}
        actions={
          <Badge tone={readiness.canRun ? "ok" : "draft"} dot>
            {readiness.canRun ? "Ready" : "Inputs missing"}
          </Badge>
        }
      />
      <CardBody className="space-y-4">
        {readiness.productionPath || readiness.streams.length ? (
          <div>
            <p className="text-xs font-medium text-mist-600">Inputs</p>
            <ul className="mt-2 divide-y divide-mist-100 rounded-md border border-mist-200">
              {readiness.productionPath ? (
                <InputRow
                  ok={readiness.productionBound}
                  name={`Production · ${readiness.productionPath}`}
                  detail={readiness.productionBound ? undefined : "missing"}
                />
              ) : null}
              {readiness.streams.map((s) => (
                <InputRow key={s.streamId} ok={s.bound} name={s.streamId} detail={s.reason} />
              ))}
            </ul>
          </div>
        ) : null}
        {readiness.warnings.length ? (
          <Alert tone="warn" title="Warnings">
            <ul className="list-disc space-y-0.5 pl-4">
              {readiness.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </Alert>
        ) : null}
        {readiness.blockers.length ? (
          <Alert tone="error" title="What's blocking the run">
            <ul className="list-disc space-y-0.5 pl-4">
              {readiness.blockers.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          </Alert>
        ) : (
          <p className="text-sm text-mist-700">
            Choose <span className="font-medium">Run calculation</span> to record a new run.
          </p>
        )}
        {canExecute ? (
          <RunCalcButton
            engagementId={engagementId}
            method={method}
            allowedSecPhases={allowedSecPhases}
          />
        ) : (
          <p className="text-xs text-mist-500">Only the lead verifier can run the calculation.</p>
        )}
      </CardBody>
    </Card>
  );
}

function InputRow({ ok, name, detail }: { ok: boolean; name: string; detail?: string | null }) {
  return (
    <li className="flex items-start gap-2.5 px-3 py-2 text-[13px]">
      {ok ? (
        <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-green-700" />
      ) : (
        <CircleDashed aria-hidden className="mt-0.5 size-4 shrink-0 text-mist-400" />
      )}
      <span className="min-w-0">
        <span className="font-mono text-xs text-mist-800">{name}</span>
        <span className="ml-2 text-xs text-mist-500">{ok ? "bound" : detail ? `skipped — ${detail}` : "skipped"}</span>
      </span>
    </li>
  );
}
