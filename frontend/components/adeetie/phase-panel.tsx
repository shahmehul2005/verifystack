import { Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { SectionTitle } from "@/components/ui/card";
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
import { cn } from "@/lib/cn";
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
      <SectionTitle
        actions={
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone="ink">{positionLabel(position)}</Badge>
            {canAdvanceAdeetiePhase(position) ? (
              <Badge tone="ok" dot>
                Pass complete · next phase can open
              </Badge>
            ) : null}
          </div>
        }
      >
        ADEETIE lifecycle
      </SectionTitle>
      <p className="mb-4 max-w-3xl text-[13px] leading-relaxed text-mist-600">
        Three pieces of work in order, with a savings gate before the last. Each phase runs the full
        setup-to-sign-off cycle, so the progress track above is for the current phase.
      </p>

      <SavingsGate savings={savings} thresholdPct={thresholdPct} />
      {actions}

      <ol className="mt-4 grid gap-3 lg:grid-cols-3">
        {ADEETIE_PHASES.map((phase, i) => {
          const spec = ADEETIE_PHASE_SPECS[phase];
          const index = phaseIndex(phase);
          const state =
            index < currentIndex ? "complete" : index === currentIndex ? "current" : "upcoming";
          return (
            <li
              key={phase}
              aria-current={state === "current" ? "step" : undefined}
              className={cn(
                "rounded-lg border bg-white p-5 shadow-xs",
                state === "current" ? "border-teal-500 ring-1 ring-teal-500/20" : "border-mist-200",
                state === "upcoming" && "bg-mist-50/60"
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  <span
                    className={cn(
                      "flex size-6 items-center justify-center rounded-full text-xs font-semibold",
                      state === "complete" && "bg-teal-600 text-white",
                      state === "current" && "border border-teal-600 text-teal-700",
                      state === "upcoming" && "border border-mist-300 text-mist-500"
                    )}
                  >
                    {state === "complete" ? <Check className="size-3.5" strokeWidth={3} /> : i + 1}
                  </span>
                  <span className="font-mono text-xs text-mist-600">{phase}</span>
                </span>
                {state === "current" ? <Badge tone="ink">Current</Badge> : null}
                {state === "complete" ? <Badge tone="ok">Passed</Badge> : null}
                {state === "upcoming" ? <Badge>Not opened</Badge> : null}
              </div>
              <h3 className="mt-3 text-sm font-semibold text-mist-950">{ADEETIE_PHASE_LABEL[phase]}</h3>
              <SpecList title="Inputs" items={spec.inputs} />
              <SpecList title="Outputs" items={spec.outputs} />
              <SpecList title="Exit gates" items={spec.exitGates} />
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function SpecList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="mt-3">
      <p className="text-xs font-medium text-mist-600">{title}</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs leading-relaxed text-mist-700 marker:text-mist-400">
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
      <Alert
        tone={a.meetsThreshold ? "ok" : "error"}
        title={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>
              {thresholdPct}% savings gate {a.meetsThreshold ? "met" : "not met"}
            </span>
            <span className="font-mono text-xs font-normal tabular">
              {formatIn(a.baselineSec, { maximumFractionDigits: 4 })} →{" "}
              {formatIn(a.postSec, { maximumFractionDigits: 4 })} {a.secUnitLabel} ={" "}
              {formatIn(a.savingsPct, { maximumFractionDigits: 2 })}%
            </span>
          </span>
        }
      >
        {a.comparabilityWarnings.length > 0 ? (
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {a.comparabilityWarnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        ) : null}
        <p className="mt-1">
          The {thresholdPct}% threshold is taken from the BEE ADEETIE scheme description and is
          marked TO VERIFY against the operative scheme guidelines.
        </p>
      </Alert>
    );
  }
  return (
    <div className="rounded-lg border border-mist-200 bg-white px-4 py-3 text-[13px] text-mist-700">
      <Badge>{thresholdPct}% savings gate · not evaluated yet</Badge>
      <p className="mt-1.5 max-w-3xl leading-relaxed">{savings.reason}</p>
    </div>
  );
}
