"use client";

import { Check, FileText, ShieldAlert } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { StatTile } from "@/components/ui/stat";
import { Table, Td, Th } from "@/components/ui/table";
import { RESOLUTION_LABEL, type ResolutionState } from "@verifystack/backend/domain/deskreview/resolution";
import { LEAD_STATUS_LABEL, type LeadRow, type LeadSchedule, type LeadStatus } from "@verifystack/backend/domain/deskreview/leadSchedule";

const TONE: Record<LeadStatus, BadgeTone> = { agrees: "ok", disagrees: "block", waiting: "draft", undecided: "neutral" };

const number = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 3 });
const signed = (n: number) => (n > 0 ? `+${number(n)}` : number(n));
const tonnes = (n: number) => `${n.toLocaleString("en-IN", { maximumFractionDigits: 1 })} tCO2e`;

/**
 * The lead tie-out schedule. Every figure comes from `buildLeadSchedule`, so
 * this page, a finding and the binder show the same numbers. A line is never
 * called material and never called verified: the 2% threshold is judged on the
 * total below, and verifying is a named person's decision.
 */
export function LeadScheduleView({
  schedule,
  findings,
  canDecide,
  hasSavedRun,
  raising,
  onRaise,
  onOpenReadings,
  running,
  onRun,
  binderHref,
}: {
  schedule: LeadSchedule;
  /** Rule ids of findings that already exist, by `DESK-<check>`. */
  findings: Record<string, { id: string; state: string }>;
  canDecide: boolean;
  hasSavedRun: boolean;
  raising: string | null;
  onRaise: (ruleId: string) => void;
  onOpenReadings: () => void;
  running: boolean;
  onRun: () => void;
  /** Where the sealed binder is downloaded from, once there is a saved run. */
  binderHref: string | null;
}) {
  const categories = [...new Set(schedule.rows.map((r) => r.category))];
  const { counts, aggregate } = schedule;

  return (
    <div className="space-y-4">
      <div className="space-y-4 rounded-lg border border-mist-200 bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-3xl">
            <h3 className="text-sm font-semibold text-mist-950">Lead tie-out schedule</h3>
            <p className="mt-1 text-[13px] leading-relaxed text-mist-700">
              Each figure the entity reported, set against what the evidence shows. A line that agrees is within the band its check allows. Whether the total is material is judged below, on the aggregate.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary" onClick={onOpenReadings}>
              <FileText />
              Figures from PDFs
            </Button>
            {binderHref ? (
              <a href={binderHref} className={cn(buttonVariants({ size: "sm", variant: "secondary" }))}>
                Download binder (PDF)
              </a>
            ) : null}
            {canDecide ? (
              <Button size="sm" onClick={onRun} disabled={running}>
                {running ? "Checking…" : "Run the checks again"}
              </Button>
            ) : null}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <StatTile label="Agree" value={counts.agrees} tone="ok" />
          <StatTile label="Disagree" value={counts.disagrees} tone={counts.disagrees ? "block" : "neutral"} />
          <StatTile label="Waiting for readings" value={counts.waiting} tone={counts.waiting ? "warn" : "neutral"} />
          <StatTile label="Cannot be decided" value={counts.undecided} />
          <StatTile label="Without a decision" value={schedule.undecided} tone={schedule.undecided ? "warn" : "ok"} />
        </div>

        {schedule.rows.length === 0 ? (
          <p className="text-[13px] text-mist-600">No checks have run yet. Run the checks to fill the schedule.</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Check</Th>
                <Th className="text-right">Reported</Th>
                <Th className="text-right">Evidenced</Th>
                <Th className="text-right">Difference</Th>
                <Th>Result</Th>
                <Th>Decision</Th>
                <Th className="text-right">Action</Th>
              </tr>
            </thead>
            <tbody>
              {categories.map((category) => (
                <CategoryRows
                  key={category}
                  category={category}
                  rows={schedule.rows.filter((r) => r.category === category)}
                  findings={findings}
                  canDecide={canDecide}
                  hasSavedRun={hasSavedRun}
                  raising={raising}
                  onRaise={onRaise}
                  onOpenReadings={onOpenReadings}
                />
              ))}
            </tbody>
          </Table>
        )}
      </div>

      {aggregate ? (
        <div className="space-y-3 rounded-lg border border-mist-200 bg-white p-4">
          <h3 className="text-sm font-semibold text-mist-950">Aggregate position</h3>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatTile label="Reported total" value={tonnes(aggregate.reportedTotal)} />
            <StatTile label={`${aggregate.fraction * 100}% of the reported total`} value={tonnes(aggregate.threshold)} />
            <StatTile label="Quantified misstatements" value={tonnes(aggregate.quantified)} tone={aggregate.over ? "block" : "ok"} />
            <StatTile label="Against the threshold" value={aggregate.over ? "Over" : "Within"} tone={aggregate.over ? "block" : "ok"} />
          </div>
          {aggregate.limitations.length > 0 ? (
            <Alert tone="warn" title="The total is incomplete">
              <ul className="list-disc space-y-0.5 pl-4">
                {aggregate.limitations.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            </Alert>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function CategoryRows({
  category,
  rows,
  findings,
  canDecide,
  hasSavedRun,
  raising,
  onRaise,
  onOpenReadings,
}: {
  category: string;
  rows: LeadRow[];
  findings: Record<string, { id: string; state: string }>;
  canDecide: boolean;
  hasSavedRun: boolean;
  raising: string | null;
  onRaise: (ruleId: string) => void;
  onOpenReadings: () => void;
}) {
  return (
    <>
      <tr>
        <td colSpan={7} className="bg-mist-100 px-3 py-1.5 text-[13px] font-medium text-mist-700">
          {category}
        </td>
      </tr>
      {rows.map((row) => {
        const finding = findings[`DESK-${row.ruleId}`] ?? null;
        return (
          <tr key={row.ruleId}>
            <Td className="min-w-[260px]">
              <p className="text-[13px] font-medium text-mist-950">{row.label}</p>
              <p className="mt-0.5 text-[12px] text-mist-600">
                {row.clause.specific ? row.clause.ref.split(" — ")[0] : "No single clause"}
                {row.clause.specific && !row.clause.verified ? " (to be confirmed)" : ""}
              </p>
              <details className="mt-1 text-[12px] text-mist-700">
                <summary className="cursor-pointer select-none text-teal-800">Show working</summary>
                <p className="mt-1 max-w-xl leading-relaxed">{row.detail}</p>
                {row.band ? <p className="mt-1 text-mist-600">Allowed band: {row.band}</p> : null}
                {row.sources.length > 0 ? (
                  <ul className="mt-1 space-y-0.5 text-mist-600">
                    {row.sources.map((s) => (
                      <li key={s.key}>
                        {s.label}: {typeof s.value === "number" ? number(s.value) : String(s.value)}
                        {s.unit ? ` ${s.unit}` : ""}
                        {s.filename || s.location ? ` — ${[s.filename, s.location].filter(Boolean).join(" · ")}` : ""}
                        {s.kind === "typed" ? " (typed)" : s.kind === "snip" ? " (snipped)" : ""}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </details>
            </Td>
            <Td className="text-right text-[13px] whitespace-nowrap tabular">{row.declared !== null ? `${number(row.declared)} ${row.unit}` : <span className="text-mist-500">Not in the sheet</span>}</Td>
            <Td className="text-right text-[13px] whitespace-nowrap tabular">{row.evidenced !== null ? `${number(row.evidenced)} ${row.unit}` : <span className="text-amber-800">Waiting</span>}</Td>
            <Td className="text-right text-[13px] whitespace-nowrap tabular">
              {row.variance !== null ? (
                <>
                  <span className={row.status === "disagrees" ? "font-medium text-red-700" : "text-mist-900"}>{signed(row.variance)}</span>
                  {row.variancePct !== null ? <span className="block text-[12px] text-mist-600">{number(row.variancePct)}%</span> : null}
                </>
              ) : (
                <span className="text-mist-500">—</span>
              )}
            </Td>
            <Td className="min-w-[140px]">
              <Badge tone={TONE[row.status]} dot>
                {LEAD_STATUS_LABEL[row.status]}
              </Badge>
            </Td>
            <Td className="min-w-[160px] text-[13px] text-mist-800">
              {row.decision ? RESOLUTION_LABEL[row.decision.state as ResolutionState] ?? row.decision.state : row.status === "disagrees" || row.status === "waiting" ? <span className="text-amber-800">Not decided</span> : <span className="text-mist-500">None needed</span>}
            </Td>
            <Td className="text-right whitespace-nowrap">
              {row.status === "disagrees" || row.status === "waiting" ? (
                finding ? (
                  <span className="inline-flex items-center gap-1 text-[13px] font-medium text-mist-700">
                    <Check className="size-3.5" />
                    Finding raised
                  </span>
                ) : canDecide && hasSavedRun ? (
                  <Button size="sm" variant="secondary" disabled={raising === row.ruleId} onClick={() => onRaise(row.ruleId)}>
                    <ShieldAlert />
                    {raising === row.ruleId ? "Raising…" : "Raise finding"}
                  </Button>
                ) : row.status === "waiting" ? (
                  <Button size="sm" variant="secondary" onClick={onOpenReadings}>
                    Enter readings
                  </Button>
                ) : null
              ) : null}
            </Td>
          </tr>
        );
      })}
    </>
  );
}
