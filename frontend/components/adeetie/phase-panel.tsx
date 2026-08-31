import { Badge } from "@/components/ui/badge";
import type { ReactNode } from "react";
import {
  ADEETIE_PHASES,
  ADEETIE_PHASE_LABEL,
  canAdvanceAdeetiePhase,
  positionLabel,
  type AdeetiePhase,
  type EngagementPosition,
} from "@verifystack/backend/domain/engagements/status";
import { ADEETIE_PHASE_SPECS } from "@verifystack/backend/domain/packs/adeetie";
import { formatIn } from "@/lib/format";
import type { SavingsOutcome } from "./sec";

function phaseIndex(phase: AdeetiePhase) {
  return ADEETIE_PHASES.indexOf(phase);
}

export function AdeetiePhasePanel({
  position,
  savings,
  thresholdPct,
  actions,
}: {
  position: EngagementPosition;
  savings: SavingsOutcome;
  thresholdPct: number;
  actions?: ReactNode;
}) {
  const current = position.phase ?? "IGEA";
  const currentIndex = phaseIndex(current);

  return (
    <section className="mb-8">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="text-[11px] uppercase tracking-wide text-stone-500">
          ADEETIE lifecycle
        </h2>
        <Badge tone="ink">{positionLabel(position)}</Badge>
        {canAdvanceAdeetiePhase(position) ? (
          <Badge tone="ok">Pass complete — next phase may be opened</Badge>
        ) : null}
      </div>
      <p className="mb-4 max-w-3xl text-sm text-stone-600">
        Three sequential pieces of work with a savings gate before the last one. Each phase runs
        the full setup → sign-off cycle, so the status track above is per phase, not per
        engagement.
      </p>

      <SavingsGate savings={savings} thresholdPct={thresholdPct} />
      {actions}

      <div className="grid gap-3 lg:grid-cols-3">
        {ADEETIE_PHASES.map((phase) => {
          const spec = ADEETIE_PHASE_SPECS[phase];
          const index = phaseIndex(phase);
          const state =
            index < currentIndex ? "complete" : index === currentIndex ? "current" : "upcoming";
          return (
            <article
              key={phase}
              className={
                state === "current"
                  ? "border border-stone-900 bg-white p-4"
                  : "border border-stone-200 bg-white p-4"
              }
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[12px] text-stone-500">{phase}</span>
                {state === "current" ? <Badge tone="ink">Current phase</Badge> : null}
                {state === "complete" ? <Badge tone="ok">Passed</Badge> : null}
                {state === "upcoming" ? <Badge>Not opened</Badge> : null}
              </div>
              <h3 className="mt-1.5 text-sm font-semibold">{ADEETIE_PHASE_LABEL[phase]}</h3>
              <SpecList title="Inputs" items={spec.inputs} />
              <SpecList title="Outputs" items={spec.outputs} />
              <SpecList title="Exit gates" items={spec.exitGates} />
            </article>
          );
        })}
      </div>
    </section>
  );
}

function SpecList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="mt-3">
      <p className="text-[11px] uppercase tracking-wide text-stone-500">{title}</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[12px] leading-relaxed text-stone-700">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function SavingsGate({
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
            ? "mb-4 border border-emerald-300 bg-emerald-50 px-3 py-2.5 text-[12px] text-emerald-900"
            : "mb-4 border border-red-300 bg-red-50 px-3 py-2.5 text-[12px] text-red-900"
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={a.meetsThreshold ? "ok" : "block"}>
            {thresholdPct}% savings gate {a.meetsThreshold ? "met" : "not met"}
          </Badge>
          <span className="font-mono tabular">
            {formatIn(a.baselineSec, { maximumFractionDigits: 4 })} → {" "}
            {formatIn(a.postSec, { maximumFractionDigits: 4 })} {a.secUnitLabel} ={" "}
            {formatIn(a.savingsPct, { maximumFractionDigits: 2 })}%
          </span>
        </div>
        {a.comparabilityWarnings.length > 0 ? (
          <ul className="mt-1.5 list-disc space-y-0.5 pl-4">
            {a.comparabilityWarnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        ) : null}
        <p className="mt-1.5">
          Threshold {thresholdPct}% is taken from the BEE ADEETIE scheme description and is marked
          TO VERIFY against the operative scheme guidelines.
        </p>
      </div>
    );
  }
  return (
    <div className="mb-4 border border-stone-300 bg-stone-50 px-3 py-2.5 text-[12px] text-stone-700">
      <Badge>{thresholdPct}% savings gate — not evaluated</Badge>
      <p className="mt-1.5 max-w-3xl leading-relaxed">{savings.reason}</p>
    </div>
  );
}
