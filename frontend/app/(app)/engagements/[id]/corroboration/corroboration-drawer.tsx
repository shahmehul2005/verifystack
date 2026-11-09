"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

// ---------------------------------------------------------------------------
// Types (mirrors the shape of canonical_evidence_values rows from Supabase)
// ---------------------------------------------------------------------------

type CevState = "suggested" | "pending_review" | "accepted" | "corrected" | "rejected" | "withdrawn";

interface CevRow {
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
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface CorroborationDrawerProps {
  engagementId: string;
  groups: Record<string, Record<string, unknown>[]>;
  docNames: Record<string, string>;
  labels: Record<string, string>;
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
  return res.json();
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
      {errorMsg && (
        <p className="text-xs text-red-600">{errorMsg}</p>
      )}

      {mode === "idle" && (
        <div className="flex flex-wrap gap-2">
          {isDecidable && (
            <>
              <button
                onClick={() => submit("accept")}
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
                submit("correct", {
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
              onClick={() => submit("reject", { rejectionNote: rejectionNote || undefined })}
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
              onClick={() => submit("withdraw", { withdrawalReason })}
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
  const [expanded, setExpanded] = useState(rows.some((r) => r.state === "suggested" || r.state === "pending_review"));

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
          {/* Count badges */}
          {(["suggested", "accepted", "corrected", "rejected", "withdrawn"] as CevState[]).map((s) => {
            const n = rows.filter((r) => r.state === s).length;
            if (!n) return null;
            return (
              <span key={s} className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATE_BADGE[s].cls}`}>
                {n} {STATE_BADGE[s].label}
              </span>
            );
          })}
          <span className="text-mist-400">{expanded ? "▲" : "▼"}</span>
        </div>
      </button>

      {expanded && (
        <div className="divide-y divide-mist-100 border-t border-mist-200">
          {rows.map((row) => {
            const badge = STATE_BADGE[row.state] ?? STATE_BADGE.suggested;
            const docName = row.document_id ? (docNames[row.document_id] ?? "unknown document") : null;
            return (
              <div key={row.id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    {/* Value */}
                    <p className="text-base font-semibold text-mist-900">{fmtValue(row)}</p>
                    {/* Period */}
                    <p className="text-xs text-mist-500">
                      {fmtPeriod(row)} · {METHOD_LABEL[row.extraction_method] ?? row.extraction_method}
                      {row.confidence !== null ? ` · ${Math.round(row.confidence * 100)}% confidence` : ""}
                    </p>
                    {/* Provenance */}
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
                    {/* Correction note */}
                    {row.state === "corrected" && row.correction_note && (
                      <p className="mt-1 text-xs text-blue-700">Note: {row.correction_note}</p>
                    )}
                  </div>
                  {/* State badge */}
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${badge.cls}`}>
                    {badge.label}
                  </span>
                </div>
                <CevRowActions
                  engagementId={engagementId}
                  row={row}
                  onDone={onDone}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function CorroborationDrawer({ engagementId, groups, docNames, labels }: CorroborationDrawerProps) {
  const router = useRouter();

  // Sort keys: suggested/pending first, then accepted/corrected, then rejected/withdrawn
  const keyOrder = (k: string) => {
    const rows = groups[k] as unknown as CevRow[];
    if (rows.some((r) => r.state === "suggested" || r.state === "pending_review")) return 0;
    if (rows.some((r) => r.state === "accepted" || r.state === "corrected")) return 1;
    return 2;
  };

  const sortedKeys = Object.keys(groups).sort((a, b) => keyOrder(a) - keyOrder(b) || a.localeCompare(b));

  if (sortedKeys.length === 0) {
    return (
      <div className="rounded-lg border border-mist-200 bg-mist-50 px-6 py-10 text-center">
        <p className="text-sm font-medium text-mist-700">No canonical evidence values yet</p>
        <p className="mt-1 text-xs text-mist-500">
          CEVs are created automatically when documents are extracted, or when desk-review readings are saved.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-mist-600">
          {sortedKeys.length} quantity group{sortedKeys.length !== 1 ? "s" : ""} ·{" "}
          {Object.values(groups).flat().length} total values
        </p>
      </div>
      {sortedKeys.map((key) => (
        <CevGroupCard
          key={key}
          canonicalKey={key}
          label={labels[key] ?? key}
          rows={groups[key] as unknown as CevRow[]}
          engagementId={engagementId}
          docNames={docNames}
          onDone={() => router.refresh()}
        />
      ))}
    </div>
  );
}

