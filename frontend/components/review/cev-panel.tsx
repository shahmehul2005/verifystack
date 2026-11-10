"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { GitMerge, TrendingUp } from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CevState =
  | "suggested"
  | "pending_review"
  | "accepted"
  | "corrected"
  | "rejected"
  | "withdrawn";

export interface CevRow {
  id: string;
  canonical_key: string;
  registry_version: string;
  extraction_method: string;
  state: CevState;
  period_kind: string;
  period_start: string | null;
  period_end: string | null;
  value_numeric: number | null;
  value_text: string | null;
  value_unit: string | null;
  value_as_stated: string | null;
  correction_numeric: number | null;
  correction_text: string | null;
  correction_unit: string | null;
  correction_note: string | null;
  confidence: number | null;
  document_id: string | null;
  provenance_page: number | null;
  provenance_source_text: string | null;
  created_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  parent_id: string | null;
  aggregated_child_count: number | null;
  aggregation_method: string | null;
  fact_id: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STATE_BADGE: Record<CevState, { label: string; cls: string }> = {
  suggested: { label: "Suggested", cls: "bg-amber-100 text-amber-800" },
  pending_review: { label: "Pending review", cls: "bg-orange-100 text-orange-800" },
  accepted: { label: "Accepted", cls: "bg-green-100 text-green-800" },
  corrected: { label: "Corrected", cls: "bg-blue-100 text-blue-800" },
  rejected: { label: "Rejected", cls: "bg-red-100 text-red-800" },
  withdrawn: { label: "Withdrawn", cls: "bg-zinc-100 text-zinc-500" },
};

const METHOD_LABEL: Record<string, string> = {
  ai_extraction: "AI extraction",
  workbook_reader: "Workbook reader",
  regex_propose: "Desk-review proposal",
  manual_entry: "Manual entry",
  site_observation: "Site observation",
};

function fmtValue(row: CevRow): string {
  if (row.state === "corrected") {
    const v = row.correction_numeric ?? row.correction_text ?? "—";
    const u = row.correction_unit ?? row.value_unit ?? "";
    return `${v}${u ? " " + u : ""} (corrected)`;
  }
  const v = row.value_numeric ?? row.value_text ?? row.value_as_stated ?? "—";
  const u = row.value_unit ?? "";
  return `${v}${u ? " " + u : ""}`;
}

function fmtPeriod(row: CevRow): string {
  if (row.period_kind === "document_period") return "document period";
  if (row.period_kind === "single_reading") return "single reading";
  if (row.period_start && row.period_end) return `${row.period_start} → ${row.period_end}`;
  return row.period_kind;
}

/** Effective numeric value respecting corrections. */
function effectiveNumeric(row: CevRow): number | null {
  if (row.state === "corrected") return row.correction_numeric ?? row.value_numeric;
  return row.value_numeric;
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function callAction(
  engagementId: string,
  action: "accept" | "correct" | "reject" | "withdraw",
  body: Record<string, unknown>
): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`/api/cev/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, engagementId }),
  });
  return res.json() as Promise<{ ok: boolean; error?: string }>;
}

// ---------------------------------------------------------------------------
// Row-level action panel
// ---------------------------------------------------------------------------

function CevRowActions({
  engagementId,
  row,
  onDone,
}: {
  engagementId: string;
  row: CevRow;
  onDone: () => void;
}) {
  const [mode, setMode] = useState<"idle" | "correct" | "reject" | "withdraw">("idle");
  const [correctionNumeric, setCorrectionNumeric] = useState("");
  const [correctionNote, setCorrectionNote] = useState("");
  const [rejectionNote, setRejectionNote] = useState("");
  const [withdrawalReason, setWithdrawalReason] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const isDecidable = row.state === "suggested" || row.state === "pending_review";
  const isAcceptedOrCorrected = row.state === "accepted" || row.state === "corrected";

  async function submit(
    action: "accept" | "correct" | "reject" | "withdraw",
    extra: Record<string, unknown> = {}
  ) {
    setErrorMsg(null);
    startTransition(async () => {
      const result = await callAction(engagementId, action, { cevId: row.id, ...extra });
      if (result.ok) {
        onDone();
      } else {
        setErrorMsg(result.error ?? "Unknown error");
      }
    });
  }

  if (!isDecidable && !isAcceptedOrCorrected) return null;

  return (
    <div className="mt-2 space-y-2 border-t border-mist-100 pt-2">
      {errorMsg && <p className="text-xs text-red-600">{errorMsg}</p>}

      {mode === "idle" && (
        <div className="flex flex-wrap gap-2">
          {isDecidable && (
            <>
              <button
                onClick={() => void submit("accept")}
                disabled={isPending}
                className="rounded bg-green-600 px-2 py-1 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
              >
                ✓ Accept
              </button>
              <button
                onClick={() => setMode("correct")}
                className="rounded bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-700"
              >
                ✎ Correct
              </button>
              <button
                onClick={() => setMode("reject")}
                className="rounded bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-700"
              >
                ✗ Reject
              </button>
            </>
          )}
          {isAcceptedOrCorrected && (
            <button
              onClick={() => setMode("withdraw")}
              className="rounded bg-zinc-600 px-2 py-1 text-xs font-medium text-white hover:bg-zinc-700"
            >
              Withdraw
            </button>
          )}
        </div>
      )}

      {mode === "correct" && (
        <div className="space-y-2">
          <input
            type="number"
            placeholder="Corrected value"
            value={correctionNumeric}
            onChange={(e) => setCorrectionNumeric(e.target.value)}
            className="w-full rounded border border-mist-200 px-2 py-1 text-sm"
          />
          <textarea
            placeholder="Correction note (required, ≥8 characters)"
            value={correctionNote}
            onChange={(e) => setCorrectionNote(e.target.value)}
            rows={2}
            className="w-full rounded border border-mist-200 px-2 py-1 text-sm"
          />
          <div className="flex gap-2">
            <button
              onClick={() =>
                void submit("correct", {
                  correctionNumeric: correctionNumeric ? Number(correctionNumeric) : undefined,
                  correctionNote,
                })
              }
              disabled={isPending || correctionNote.length < 8}
              className="rounded bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              Save correction
            </button>
            <button onClick={() => setMode("idle")} className="text-xs text-mist-600 hover:underline">
              Cancel
            </button>
          </div>
        </div>
      )}

      {mode === "reject" && (
        <div className="space-y-2">
          <input
            type="text"
            placeholder="Reason (optional)"
            value={rejectionNote}
            onChange={(e) => setRejectionNote(e.target.value)}
            className="w-full rounded border border-mist-200 px-2 py-1 text-sm"
          />
          <div className="flex gap-2">
            <button
              onClick={() => void submit("reject", { rejectionNote: rejectionNote || undefined })}
              disabled={isPending}
              className="rounded bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              Confirm rejection
            </button>
            <button onClick={() => setMode("idle")} className="text-xs text-mist-600 hover:underline">
              Cancel
            </button>
          </div>
        </div>
      )}

      {mode === "withdraw" && (
        <div className="space-y-2">
          <input
            type="text"
            placeholder="Withdrawal reason (required, ≥8 characters)"
            value={withdrawalReason}
            onChange={(e) => setWithdrawalReason(e.target.value)}
            className="w-full rounded border border-mist-200 px-2 py-1 text-sm"
          />
          <div className="flex gap-2">
            <button
              onClick={() => void submit("withdraw", { withdrawalReason })}
              disabled={isPending || withdrawalReason.length < 8}
              className="rounded bg-zinc-600 px-2 py-1 text-xs font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
            >
              Confirm withdrawal
            </button>
            <button onClick={() => setMode("idle")} className="text-xs text-mist-600 hover:underline">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Roll-up trigger button — shown when all monthly children are settled
// ---------------------------------------------------------------------------

function RollUpButton({
  engagementId,
  canonicalKey,
  monthlyRows,
  onDone,
}: {
  engagementId: string;
  canonicalKey: string;
  monthlyRows: CevRow[];
  onDone: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const childIds = monthlyRows.map((r) => r.id);
  // Code computes; models never do.
  const computedValue = monthlyRows.reduce(
    (acc, r) => acc + (effectiveNumeric(r) ?? 0),
    0
  );
  const unit = monthlyRows[0]?.value_unit ?? "";
  const registryVersion = monthlyRows[0]?.registry_version ?? "v0.2.0-provisional";

  function trigger() {
    setErrorMsg(null);
    startTransition(async () => {
      const res = await fetch("/api/cev/rollup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          engagementId,
          canonicalKey,
          childIds,
          aggregationMethod: "sum",
          registryVersion,
        }),
      });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (json.ok) {
        onDone();
      } else {
        setErrorMsg(json.error ?? "Roll-up failed");
      }
    });
  }

  return (
    <div className="rounded-md border border-teal-200 bg-teal-50 px-3 py-2">
      <p className="text-xs font-medium text-teal-900">
        All {monthlyRows.length} monthly values are settled.
      </p>
      <p className="mt-0.5 text-xs text-teal-700">
        Computed annual total: <span className="font-mono font-semibold">{computedValue.toLocaleString()}{unit ? ` ${unit}` : ""}</span> (sum).
        Trigger the roll-up to create an annual CEV for auditor review.
      </p>
      {errorMsg && <p className="mt-1 text-xs text-red-600">{errorMsg}</p>}
      <button
        onClick={trigger}
        disabled={isPending}
        className="mt-2 inline-flex items-center gap-1 rounded bg-teal-700 px-2.5 py-1 text-xs font-medium text-white hover:bg-teal-800 disabled:opacity-50"
      >
        <GitMerge className="h-3 w-3" />
        {isPending ? "Computing…" : "Compute annual roll-up"}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Promote to fact button — shown for accepted/corrected annual rows
// ---------------------------------------------------------------------------

function PromoteButton({
  engagementId,
  row,
  onDone,
}: {
  engagementId: string;
  row: CevRow;
  onDone: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [fieldPath, setFieldPath] = useState("");
  const [showForm, setShowForm] = useState(false);

  function promote() {
    if (!fieldPath.trim()) return;
    setErrorMsg(null);
    startTransition(async () => {
      const res = await fetch("/api/cev/promote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cevId: row.id,
          engagementId,
          fieldPath: fieldPath.trim(),
          unit: row.correction_unit ?? row.value_unit ?? "",
        }),
      });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (json.ok) {
        onDone();
      } else {
        setErrorMsg(json.error ?? "Promotion failed");
      }
    });
  }

  if (!showForm) {
    return (
      <button
        onClick={() => setShowForm(true)}
        className="inline-flex items-center gap-1 rounded bg-teal-700 px-2.5 py-1 text-xs font-medium text-white hover:bg-teal-800"
      >
        <TrendingUp className="h-3 w-3" />
        Promote to facts ledger
      </button>
    );
  }

  return (
    <div className="space-y-2">
      {errorMsg && <p className="text-xs text-red-600">{errorMsg}</p>}
      <input
        type="text"
        placeholder="Field path in pack (e.g. calorificValue)"
        value={fieldPath}
        onChange={(e) => setFieldPath(e.target.value)}
        className="w-full rounded border border-mist-200 px-2 py-1 text-sm"
      />
      <div className="flex gap-2">
        <button
          onClick={promote}
          disabled={isPending || !fieldPath.trim()}
          className="rounded bg-teal-700 px-2 py-1 text-xs font-medium text-white hover:bg-teal-800 disabled:opacity-50"
        >
          {isPending ? "Promoting…" : "Confirm promotion"}
        </button>
        <button onClick={() => setShowForm(false)} className="text-xs text-mist-600 hover:underline">
          Cancel
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Group card — all CEV rows for one canonical key
// ---------------------------------------------------------------------------

function CevGroupCard({
  canonicalKey,
  label,
  rows,
  engagementId,
  docNames,
  onDone,
}: {
  canonicalKey: string;
  label: string;
  rows: CevRow[];
  engagementId: string;
  docNames: Record<string, string>;
  onDone: () => void;
}) {
  const [expanded, setExpanded] = useState(
    rows.some((r) => r.state === "suggested" || r.state === "pending_review")
  );

  // Roll-up eligibility: all monthly children are accepted/corrected and no annual row exists yet
  const monthlySettled = rows.filter(
    (r) =>
      r.period_kind === "monthly" &&
      (r.state === "accepted" || r.state === "corrected") &&
      !r.parent_id
  );
  const hasAnnualRow = rows.some((r) => r.period_kind === "annual");
  const hasUnsettledMonthly = rows.some(
    (r) => r.period_kind === "monthly" && !["accepted", "corrected"].includes(r.state) && !r.parent_id
  );
  const showRollUp =
    monthlySettled.length >= 2 && !hasAnnualRow && !hasUnsettledMonthly;

  // Promote eligibility: accepted/corrected annual row without a fact_id
  const annualReadyToPromote = rows.find(
    (r) =>
      r.period_kind === "annual" &&
      (r.state === "accepted" || r.state === "corrected") &&
      !r.fact_id
  );

  return (
    <div className="rounded-lg border border-mist-200 bg-white shadow-sm">
      <button
        onClick={() => setExpanded((x) => !x)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-mist-50"
      >
        <div>
          <span className="font-mono text-xs text-mist-500">{canonicalKey}</span>
          <p className="text-sm font-medium text-mist-900">{label || canonicalKey}</p>
        </div>
        <div className="flex items-center gap-2">
          {(["suggested", "accepted", "corrected", "rejected", "withdrawn"] as CevState[]).map((s) => {
            const n = rows.filter((r) => r.state === s).length;
            if (!n) return null;
            return (
              <span
                key={s}
                className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATE_BADGE[s].cls}`}
              >
                {n} {STATE_BADGE[s].label}
              </span>
            );
          })}
          <span className="text-mist-400">{expanded ? "▲" : "▼"}</span>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-mist-200">
          {/* Roll-up trigger */}
          {showRollUp && (
            <div className="border-b border-mist-100 px-4 py-3">
              <RollUpButton
                engagementId={engagementId}
                canonicalKey={canonicalKey}
                monthlyRows={monthlySettled}
                onDone={onDone}
              />
            </div>
          )}

          {/* Promote to facts trigger */}
          {annualReadyToPromote && (
            <div className="border-b border-mist-100 px-4 py-3">
              <p className="mb-1.5 text-xs font-medium text-teal-900">
                Annual CEV accepted — ready for the facts ledger.
              </p>
              <PromoteButton
                engagementId={engagementId}
                row={annualReadyToPromote}
                onDone={onDone}
              />
            </div>
          )}

          <div className="divide-y divide-mist-100">
            {rows.map((row) => {
              const badge = STATE_BADGE[row.state] ?? STATE_BADGE.suggested;
              const docName = row.document_id ? (docNames[row.document_id] ?? "unknown document") : null;
              return (
                <div key={row.id} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-base font-semibold text-mist-900">{fmtValue(row)}</p>
                      <p className="text-xs text-mist-500">
                        {fmtPeriod(row)} · {METHOD_LABEL[row.extraction_method] ?? row.extraction_method}
                        {row.confidence !== null
                          ? ` · ${Math.round(row.confidence * 100)}% confidence`
                          : ""}
                        {row.aggregated_child_count
                          ? ` · roll-up of ${row.aggregated_child_count} values (${row.aggregation_method ?? ""})`
                          : ""}
                      </p>
                      {docName && (
                        <p className="mt-0.5 text-xs text-mist-600">
                          {docName}
                          {row.provenance_page !== null ? `, p.${row.provenance_page}` : ""}
                        </p>
                      )}
                      {row.provenance_source_text && (
                        <blockquote className="mt-1 border-l-2 border-mist-300 pl-2 text-xs italic text-mist-500">
                          {row.provenance_source_text.slice(0, 200)}
                          {row.provenance_source_text.length > 200 ? "…" : ""}
                        </blockquote>
                      )}
                      {row.state === "corrected" && row.correction_note && (
                        <p className="mt-1 text-xs text-blue-700">Note: {row.correction_note}</p>
                      )}
                      {row.fact_id && (
                        <p className="mt-1 text-xs text-green-700">
                          ✓ Promoted to facts ledger
                        </p>
                      )}
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${badge.cls}`}
                    >
                      {badge.label}
                    </span>
                  </div>
                  <CevRowActions engagementId={engagementId} row={row} onDone={onDone} />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main exported component
// ---------------------------------------------------------------------------

export function CevPanel({
  engagementId,
  groups,
  docNames,
  labels,
}: {
  engagementId: string;
  /** canonical_key → array of CevRow */
  groups: Record<string, CevRow[]>;
  /** document_id → original_filename */
  docNames: Record<string, string>;
  /** canonical_key → human-readable label from the registry */
  labels: Record<string, string>;
}) {
  const router = useRouter();

  const keyOrder = (k: string) => {
    const rows = groups[k]!;
    if (rows.some((r) => r.state === "suggested" || r.state === "pending_review")) return 0;
    if (rows.some((r) => r.state === "accepted" || r.state === "corrected")) return 1;
    return 2;
  };

  const sortedKeys = Object.keys(groups).sort(
    (a, b) => keyOrder(a) - keyOrder(b) || a.localeCompare(b)
  );

  if (sortedKeys.length === 0) {
    return (
      <div className="rounded-lg border border-mist-200 bg-mist-50 px-6 py-10 text-center">
        <p className="text-sm font-medium text-mist-700">No canonical evidence values yet</p>
        <p className="mt-1 text-xs text-mist-500">
          CEVs are created automatically when documents are extracted, or when desk-review readings are
          saved.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-mist-600">
        {sortedKeys.length} quantity group{sortedKeys.length !== 1 ? "s" : ""} ·{" "}
        {Object.values(groups).flat().length} total values
      </p>
      {sortedKeys.map((key) => (
        <CevGroupCard
          key={key}
          canonicalKey={key}
          label={labels[key] ?? key}
          rows={groups[key]!}
          engagementId={engagementId}
          docNames={docNames}
          onDone={() => router.refresh()}
        />
      ))}
    </div>
  );
}

