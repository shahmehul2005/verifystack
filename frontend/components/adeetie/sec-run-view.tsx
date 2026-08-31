import { Badge } from "@/components/ui/badge";
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
        title="No SEC run"
        body="Accept facts for the energy streams and the production log, then run the calculation. A baseline SEC is required before the savings gate can be evaluated."
      />
    );
  }

  return (
    <>
      <div className="mb-6 grid gap-2 sm:grid-cols-3">
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
      <div
        className={
          a.meetsThreshold
            ? "mb-6 border border-emerald-300 bg-emerald-50 px-3 py-2.5 text-[12px] text-emerald-900"
            : "mb-6 border border-red-300 bg-red-50 px-3 py-2.5 text-[12px] text-red-900"
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={a.meetsThreshold ? "ok" : "block"}>
            {thresholdPct}% gate {a.meetsThreshold ? "met" : "not met"}
          </Badge>
          <span className="font-mono tabular">
            {formatIn(a.baselineSec, { maximumFractionDigits: 4 })} →{" "}
            {formatIn(a.postSec, { maximumFractionDigits: 4 })} {a.secUnitLabel}
          </span>
          <span>
            Energy saved at post-implementation output:{" "}
            {formatIn(a.energySavedAtPostOutput.value, { maximumFractionDigits: 3 })}{" "}
            {a.energySavedAtPostOutput.unit}
          </span>
        </div>
        {a.comparabilityWarnings.length > 0 ? (
          <ul className="mt-1.5 list-disc space-y-0.5 pl-4">
            {a.comparabilityWarnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        ) : null}
        <p className="mt-1.5 font-mono text-[11px]">
          baseline {a.baselineInputHash.slice(0, 16)}… · post {a.postInputHash.slice(0, 16)}…
        </p>
      </div>
    );
  }
  return (
    <div className="mb-6 border border-stone-300 bg-stone-50 px-3 py-2.5 text-[12px] text-stone-700">
      <Badge>{thresholdPct}% gate — not evaluated</Badge>
      <p className="mt-1.5 max-w-3xl leading-relaxed">{savings.reason}</p>
    </div>
  );
}

function SecRunSection({ run }: { run: SecRun }) {
  const r = run.result;
  const unverified = r.streams.flatMap((s) => s.factorsUsed.filter((f) => !f.verified));

  return (
    <section className="mb-8">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold">{PHASE_LABEL[r.phase]}</h2>
        <Badge tone="ink">{r.periodLabel}</Badge>
        <Badge>{run.row.draft_mode ? "draft run" : "non-draft run"}</Badge>
        <span className="text-[12px] text-stone-500">{formatIst(run.row.created_at)}</span>
      </div>
      <p className="mb-3 font-mono text-[11px] text-stone-500">
        sec-engine {r.secEngineVersion} · factors {r.factorSetVersion} · pack {run.row.pack_id}@
        {run.row.pack_version} · input {r.inputsHash.slice(0, 16)}…
      </p>

      <div className="mb-3 grid gap-2 sm:grid-cols-3">
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

      {unverified.length > 0 ? (
        <div className="mb-3 border border-amber-400 bg-amber-50 px-3 py-2 text-[12px] text-amber-950">
          <Badge tone="draft">Unverified factors</Badge>
          <span className="ml-2">
            {unverified.length} factor value(s) in this run are placeholders that no human has read
            back against a published source. A non-draft run is refused while that is true, and
            this SEC figure must not be filed.
          </span>
        </div>
      ) : null}

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
                <div className="font-mono text-[11px] text-stone-500">
                  {s.streamId} · {s.kind}
                </div>
              </Td>
              <Td className="tabular whitespace-nowrap">
                <div>
                  {formatIn(s.energyReported.value, { maximumFractionDigits: 3 })}{" "}
                  {s.energyReported.unit}
                </div>
                <div className="text-[11px] text-stone-500">
                  {formatIn(s.energyMJ.value, { maximumFractionDigits: 1 })} MJ
                </div>
              </Td>
              <Td className="tabular">{formatIn(s.sharePct, { maximumFractionDigits: 2 })}%</Td>
              <Td className="max-w-md font-mono text-[11px] leading-relaxed text-stone-600">
                {s.derivation}
              </Td>
              <Td className="text-[11px]">
                {s.factorsUsed.length === 0 ? (
                  <span className="text-stone-500">none — exact conversion</span>
                ) : (
                  <ul className="space-y-1">
                    {s.factorsUsed.map((f) => (
                      <li key={`${f.id}::${f.vintage}`} className="flex flex-wrap items-center gap-1">
                        <span className="font-mono">
                          {f.id} ({f.vintage}) {f.value} {f.unit}
                        </span>
                        <Badge tone={f.verified ? "ok" : "draft"}>
                          {f.verified ? "verified" : "unverified"}
                        </Badge>
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
        <p className="mt-2 text-[12px] text-stone-600">
          Contracted demand {r.demand.contractedDemandKVA ?? "—"} kVA · maximum demand{" "}
          {r.demand.maximumDemandKVA ?? "—"} kVA · utilisation{" "}
          {r.demand.demandUtilisationPct ?? "—"}%. Apparent power is never summed into the energy
          total.
        </p>
      ) : null}

      {r.warnings.length > 0 ? (
        <div className="mt-3 border border-stone-200 bg-white px-3 py-2 text-[12px] text-stone-700">
          <p className="text-[11px] uppercase tracking-wide text-stone-500">Run warnings</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 leading-relaxed">
            {r.warnings.map((w, i) => (
              <li key={`${i}-${w.slice(0, 24)}`}>{w}</li>
            ))}
          </ul>
        </div>
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
  const border =
    tone === "ok"
      ? "border-emerald-300"
      : tone === "block"
        ? "border-red-300"
        : "border-stone-200";
  return (
    <div className={`border ${border} bg-white p-3`}>
      <p className="text-[11px] uppercase tracking-wide text-stone-500">{label}</p>
      <p className="font-mono text-lg tabular">{value}</p>
    </div>
  );
}
