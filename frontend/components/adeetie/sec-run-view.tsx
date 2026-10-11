import { Calculator } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { cn } from "@/lib/cn";
import { Table, Td, Th } from "@/components/ui/table";
import { EmptyState } from "@/components/states";
import { formatIn, formatIst } from "@/lib/format";
import type { SecResult } from "@verifystack/backend/domain/calc/sec";
import type { SavingsOutcome, SecRun, SecRunSet } from "./sec";

const PHASE_LABEL: Record<SecResult["phase"], string> = {
  baseline: "Baseline SEC",
  post_implementation: "Post-implementation SEC",
};

export function SecRunView({
  set,
  savings,
  thresholdPct,
}: {
  set: SecRunSet;
  savings: SavingsOutcome;
  thresholdPct: number;
}) {
  if (!set.runs.length) {
    return (
      <EmptyState
        icon={Calculator}
        title="No SEC run yet"
        body="Accept facts for the energy streams and the production log, then run the calculation. A baseline SEC is required before the savings gate can be evaluated."
      />
    );
  }

  return (
    <>
      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <Stat
          label="Baseline SEC"
          value={
            set.baseline
              ? `${formatIn(set.baseline.result.sec, { maximumFractionDigits: 4 })} ${set.baseline.result.secUnitLabel}`
              : "—"
          }
        />
        <Stat
          label="Post-implementation SEC"
          value={
            set.post
              ? `${formatIn(set.post.result.sec, { maximumFractionDigits: 4 })} ${set.post.result.secUnitLabel}`
              : "—"
          }
        />
        <Stat
          label={`Savings vs ${thresholdPct}% gate`}
          value={
            savings.kind === "ok"
              ? `${formatIn(savings.assessment.savingsPct, { maximumFractionDigits: 2 })}%`
              : "not evaluated"
          }
          tone={
            savings.kind === "ok"
              ? savings.assessment.meetsThreshold
                ? "ok"
                : "block"
              : "neutral"
          }
        />
      </div>

      <SavingsSummary savings={savings} thresholdPct={thresholdPct} />

      {set.baseline ? <SecRunSection run={set.baseline} /> : null}
      {set.post ? <SecRunSection run={set.post} /> : null}
    </>
  );
}

function SavingsSummary({
  savings,
  thresholdPct,
}: {
  savings: SavingsOutcome;
  thresholdPct: number;
}) {
  if (savings.kind === "ok") {
    const a = savings.assessment;
    return (
      <Alert
        tone={a.meetsThreshold ? "ok" : "error"}
        className="mb-6"
        title={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>
              {thresholdPct}% gate {a.meetsThreshold ? "met" : "not met"}
            </span>
            <span className="font-mono text-xs font-normal tabular">
              {formatIn(a.baselineSec, { maximumFractionDigits: 4 })} →{" "}
              {formatIn(a.postSec, { maximumFractionDigits: 4 })} {a.secUnitLabel}
            </span>
          </span>
        }
      >
        <p>
          Energy saved at post-implementation output:{" "}
          <span className="tabular">
            {formatIn(a.energySavedAtPostOutput.value, { maximumFractionDigits: 3 })}{" "}
            {a.energySavedAtPostOutput.unit}
          </span>
        </p>
        {a.comparabilityWarnings.length > 0 ? (
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {a.comparabilityWarnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        ) : null}
        <p className="mt-1 font-mono text-xs opacity-80">
          baseline {a.baselineInputHash.slice(0, 16)}… · post {a.postInputHash.slice(0, 16)}…
        </p>
      </Alert>
    );
  }
  return (
    <div className="mb-6 rounded-lg border border-mist-200 bg-white px-4 py-3 text-[13px] text-mist-700">
      <Badge>{thresholdPct}% gate · not evaluated yet</Badge>
      <p className="mt-1.5 max-w-3xl leading-relaxed">{savings.reason}</p>
    </div>
  );
}

function SecRunSection({ run }: { run: SecRun }) {
  const r = run.result;

  return (
    <section className="mb-8">
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <h2 className="text-[15px] font-semibold text-mist-950">{PHASE_LABEL[r.phase]}</h2>
        <Badge tone="ink">{r.periodLabel}</Badge>
        <span className="text-xs text-mist-500">{formatIst(run.row.created_at)}</span>
      </div>
      <p className="mb-4 font-mono text-xs text-mist-500">
        sec-engine {r.secEngineVersion} · factors {r.factorSetVersion} · pack {run.row.pack_id}@
        {run.row.pack_version} · input {r.inputsHash.slice(0, 16)}…
      </p>

      <div className="mb-3 grid gap-3 sm:grid-cols-3">
        <Stat
          label="Total energy"
          value={`${formatIn(r.totalEnergy.value, { maximumFractionDigits: 3 })} ${r.totalEnergy.unit}`}
        />
        <Stat
          label={r.productUnitLabel.replaceAll("_", " ")}
          value={`${formatIn(r.production.value, { maximumFractionDigits: 3 })} ${r.production.unit}`}
        />
        <Stat
          label="SEC"
          value={`${formatIn(r.sec, { maximumFractionDigits: 4 })} ${r.secUnitLabel}`}
        />
      </div>

      <Table>
        <thead>
          <tr>
            <Th>Stream</Th>
            <Th>Energy</Th>
            <Th>Share</Th>
            <Th>Derivation</Th>
            <Th>Factors</Th>
          </tr>
        </thead>
        <tbody>
          {r.streams.map((s) => (
            <tr key={s.streamId}>
              <Td>
                <div className="text-[13px]">{s.label}</div>
                <div className="font-mono text-xs text-mist-500">
                  {s.streamId} · {s.kind}
                </div>
              </Td>
              <Td className="tabular whitespace-nowrap">
                <div>
                  {formatIn(s.energyReported.value, { maximumFractionDigits: 3 })}{" "}
                  {s.energyReported.unit}
                </div>
                <div className="text-xs text-mist-500">
                  {formatIn(s.energyMJ.value, { maximumFractionDigits: 1 })} MJ
                </div>
              </Td>
              <Td className="tabular">{formatIn(s.sharePct, { maximumFractionDigits: 2 })}%</Td>
              <Td className="max-w-md font-mono text-xs leading-relaxed text-mist-600">
                {s.derivation}
              </Td>
              <Td className="text-xs">
                {s.factorsUsed.length === 0 ? (
                  <span className="text-mist-500">none — exact conversion</span>
                ) : (
                  <ul className="space-y-1">
                    {s.factorsUsed.map((f) => (
                      <li key={`${f.id}::${f.vintage}`} className="flex flex-wrap items-center gap-1">
                        <span className="font-mono">
                          {f.id} ({f.vintage}) {f.value} {f.unit}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>

      {r.demand ? (
        <p className="mt-2 text-xs text-mist-600">
          Contracted demand {r.demand.contractedDemandKVA ?? "—"} kVA · maximum demand{" "}
          {r.demand.maximumDemandKVA ?? "—"} kVA · utilisation{" "}
          {r.demand.demandUtilisationPct ?? "—"}%. Apparent power is never summed into the energy
          total.
        </p>
      ) : null}

      {r.warnings.length > 0 ? (
        <Alert tone="warn" title="Run warnings" className="mt-3">
          <ul className="list-disc space-y-0.5 pl-4">
            {r.warnings.map((w, i) => (
              <li key={`${i}-${w.slice(0, 24)}`}>{w}</li>
            ))}
          </ul>
        </Alert>
      ) : null}
    </section>
  );
}

function Stat({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "ok" | "block";
}) {
  return (
    <div
      className={cn(
        "rounded-lg border bg-white px-4 py-3.5 shadow-xs",
        tone === "ok" ? "border-green-200" : tone === "block" ? "border-red-200" : "border-mist-200"
      )}
    >
      <p className="text-xs font-medium text-mist-600">{label}</p>
      <p
        className={cn(
          "mt-1 text-lg font-semibold tracking-tight tabular",
          tone === "ok" ? "text-green-800" : tone === "block" ? "text-red-700" : "text-mist-950"
        )}
      >
        {value}
      </p>
    </div>
  );
}
