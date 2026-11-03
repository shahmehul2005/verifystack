"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ListChecks } from "lucide-react";
import type { SummaryCandidate, DraftStatus } from "@verifystack/backend/domain/intake/summary";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/input";
import { useSoftReload } from "@/lib/soft-reload";

export interface TagOption {
  path: string;
  label: string;
}

interface SheetView {
  name: string;
  candidates: SummaryCandidate[];
}

interface Row {
  col: number;
  include: boolean;
  label: string;
  fieldPath: string;
  unit: string;
  value: string;
}

const STATUS: Record<DraftStatus, { label: string; tone: BadgeTone }> = {
  matches: { label: "Matches the rows", tone: "ok" },
  rounding: { label: "Within rounding", tone: "neutral" },
  differs: { label: "Differs from the rows", tone: "block" },
  not_stored: { label: "Workbook stored no result", tone: "draft" },
  not_recomputable: { label: "Not recomputed", tone: "draft" },
  computed: { label: "Summed here", tone: "neutral" },
};

const TAG_PATTERN = /^[A-Za-z0-9_.\-[\]]+$/;

function initialRows(c: SummaryCandidate): Row[] {
  return c.drafts.map((d) => ({
    col: d.col,
    include: d.preferredValue !== null,
    label: d.header,
    fieldPath: d.suggestedFieldPath,
    unit: d.suggestedUnit ?? "",
    value: d.preferredValue === null ? "" : String(d.preferredValue),
  }));
}

function optionLabel(sheet: string, c: SummaryCandidate): string {
  if (c.source === "computed") {
    return `${sheet} · totals summed here from rows ${c.firstDataRow}–${c.lastDataRow} (no total row in the file)`;
  }
  return `${sheet} · total row ${c.totalRow}${c.totalLabel ? ` (${c.totalLabel})` : ""} · ${c.dataRowCount} rows`;
}

/**
 * Review totals on a spreadsheet or CSV. A file with a total row is checked against
 * its rows. A file without one gets its totals summed here, one per additive column,
 * named by the column header. The auditor edits what needs editing, then approves.
 * Only approved rows become facts.
 */
export function SummaryReviewButton({
  documentId,
  documentName,
  engagementId,
  targets,
}: {
  documentId: string;
  documentName: string;
  engagementId: string;
  targets: TagOption[];
}) {
  const { softReload, isRefreshing } = useSoftReload();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sheets, setSheets] = useState<SheetView[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [choice, setChoice] = useState<{ sheet: string; key: string } | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const all = (sheets ?? []).flatMap((s) => s.candidates.map((c) => ({ sheet: s.name, candidate: c })));
  const selected = all.find((x) => x.sheet === choice?.sheet && x.candidate.key === choice?.key) ?? null;

  async function openAndLoad() {
    setOpen(true);
    setLoading(true);
    setLoadError(null);
    const res = await fetch(`/api/documents/${documentId}/summary`);
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; sheets?: SheetView[] };
    setLoading(false);
    if (!res.ok || !json.ok || !json.sheets) {
      setLoadError(json.error ?? "Could not read the totals in this file.");
      return;
    }
    setSheets(json.sheets);
    // Prefer a total row the file already has; otherwise the first computed table.
    const flat = json.sheets.flatMap((s) => s.candidates.map((c) => ({ sheet: s.name, c })));
    const first = flat.find((x) => x.c.source === "total_row") ?? flat[0];
    if (first) {
      setChoice({ sheet: first.sheet, key: first.c.key });
      setRows(initialRows(first.c));
    } else {
      setChoice(null);
      setRows([]);
    }
  }

  function choose(sheet: string, key: string) {
    const found = all.find((x) => x.sheet === sheet && x.candidate.key === key);
    if (!found) return;
    setChoice({ sheet, key });
    setRows(initialRows(found.candidate));
  }

  function patch(col: number, change: Partial<Row>) {
    setRows((cur) => cur.map((r) => (r.col === col ? { ...r, ...change } : r)));
  }

  const chosen = rows.filter((r) => r.include);
  const problems = chosen.flatMap((r) => {
    const out: string[] = [];
    if (!r.label.trim()) out.push("Every included total needs a metric name.");
    if (!TAG_PATTERN.test(r.fieldPath.trim())) out.push(`"${r.fieldPath}" is not a valid tag. Use letters, digits and dots.`);
    if (r.value.trim() === "" || !Number.isFinite(Number(r.value))) out.push(`"${r.label}" needs a number.`);
    return out;
  });
  const seenTags = new Set<string>();
  for (const r of chosen) {
    const tag = r.fieldPath.trim();
    if (seenTags.has(tag)) problems.push(`The tag "${tag}" is used twice.`);
    seenTags.add(tag);
  }

  async function approve() {
    if (!selected || chosen.length === 0 || problems.length > 0) return;
    setSubmitting(true);
    const res = await fetch(`/api/documents/${documentId}/summary`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        engagementId,
        sheet: selected.sheet,
        candidateKey: selected.candidate.key,
        approvals: chosen.map((r) => ({
          col: r.col,
          fieldPath: r.fieldPath.trim(),
          unit: r.unit.trim() || null,
          label: r.label.trim(),
          value: Number(r.value),
        })),
      }),
    });
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; committed?: number };
    setSubmitting(false);
    if (!res.ok || !json.ok) {
      toast.error(json.error ?? "Could not commit these totals");
      return;
    }
    toast.success(`${json.committed ?? chosen.length} total(s) committed to the Facts Ledger`);
    setOpen(false);
    softReload();
  }

  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        disabled={isRefreshing}
        onClick={() => void openAndLoad()}
        aria-label={`Review totals in ${documentName}`}
      >
        <ListChecks />
        Review totals
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Review totals" className="max-w-5xl">
        {loading ? (
          <p className="text-sm text-mist-600">Reading the file and working out its totals…</p>
        ) : loadError ? (
          <p className="text-sm text-red-700">{loadError}</p>
        ) : !sheets || all.length === 0 ? (
          <p className="text-sm text-mist-600">
            No table with a header row and numbers was found in {documentName}. Map cells directly from the sheet
            instead.
          </p>
        ) : (
          <div className="space-y-5">
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-0 flex-1">
                <Label htmlFor="summary-total">Totals to review</Label>
                <select
                  id="summary-total"
                  className="h-9 w-full max-w-xl rounded-md border border-mist-300 bg-white px-3 text-sm"
                  value={selected ? `${selected.sheet}|${selected.candidate.key}` : ""}
                  onChange={(e) => {
                    const [sheet, key] = e.target.value.split("|");
                    choose(sheet!, key!);
                  }}
                >
                  {all.map(({ sheet, candidate }) => (
                    <option key={`${sheet}|${candidate.key}`} value={`${sheet}|${candidate.key}`}>
                      {optionLabel(sheet, candidate)}
                    </option>
                  ))}
                </select>
              </div>
              {selected ? (
                <p className="text-xs text-mist-600">
                  {selected.candidate.source === "computed"
                    ? `Header row ${selected.candidate.headerRow} · rows ${selected.candidate.firstDataRow} to ${selected.candidate.lastDataRow} summed here`
                    : `Header row ${selected.candidate.headerRow ?? "not found"} · data rows ${selected.candidate.firstDataRow ?? "–"} to ${selected.candidate.lastDataRow ?? "–"}`}
                </p>
              ) : null}
            </div>

            {selected?.candidate.coverage ? (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                These totals cover {selected.candidate.coverage.rows} dated rows, from{" "}
                {selected.candidate.coverage.first} to {selected.candidate.coverage.last}. A monthly total is not an
                annual figure. Check the period before you approve it.
              </div>
            ) : null}
            {selected?.candidate.notes.map((n) => (
              <p key={n} className="text-xs text-mist-600">
                {n}
              </p>
            ))}

            <div className="max-h-[50vh] overflow-auto rounded-md border border-mist-200">
              <table className="min-w-full text-xs">
                <thead className="sticky top-0 bg-mist-100 text-left text-mist-600">
                  <tr>
                    <th className="px-2 py-1.5 font-medium">Use</th>
                    <th className="px-2 py-1.5 font-medium">Metric (column header)</th>
                    <th className="px-2 py-1.5 font-medium">Tag</th>
                    <th className="px-2 py-1.5 font-medium">Unit</th>
                    <th className="px-2 py-1.5 font-medium">Value to commit</th>
                    <th className="px-2 py-1.5 font-medium">Workbook total</th>
                    <th className="px-2 py-1.5 font-medium">Sum of rows</th>
                    <th className="px-2 py-1.5 font-medium">Check</th>
                  </tr>
                </thead>
                <tbody>
                  {selected?.candidate.drafts.map((d) => {
                    const row = rows.find((r) => r.col === d.col);
                    if (!row) return null;
                    const status = STATUS[d.status];
                    const computed = d.status === "computed";
                    return (
                      <tr key={d.col} className="border-t border-mist-100 align-top">
                        <td className="px-2 py-1.5">
                          <input
                            type="checkbox"
                            aria-label={`Include ${d.header}`}
                            checked={row.include}
                            onChange={(e) => patch(d.col, { include: e.target.checked })}
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <Input
                            aria-label={`Metric name for ${d.header}`}
                            className="h-8 min-w-40 text-xs"
                            value={row.label}
                            onChange={(e) => patch(d.col, { label: e.target.value })}
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <Input
                            aria-label={`Tag for ${d.header}`}
                            list="summary-tags"
                            className="h-8 min-w-40 font-mono text-xs"
                            value={row.fieldPath}
                            onChange={(e) => patch(d.col, { fieldPath: e.target.value })}
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <Input
                            aria-label={`Unit for ${d.header}`}
                            className="h-8 w-24 text-xs"
                            value={row.unit}
                            onChange={(e) => patch(d.col, { unit: e.target.value })}
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <Input
                            aria-label={`Value for ${d.header}`}
                            type="number"
                            step="any"
                            className="h-8 w-32 text-xs tabular"
                            value={row.value}
                            onChange={(e) => patch(d.col, { value: e.target.value })}
                          />
                        </td>
                        <td className="px-2 py-1.5 font-mono text-mist-700">
                          {computed ? (
                            <span className="text-mist-500">no total row in the file</span>
                          ) : (
                            <>
                              {d.cellRef}
                              <br />
                              {d.cachedValue === null ? "not stored" : d.cachedValue}
                              {d.formula ? <span className="block text-mist-500">={d.formula}</span> : null}
                            </>
                          )}
                        </td>
                        <td className="px-2 py-1.5 font-mono text-mist-700">
                          {d.recomputed === null ? "–" : d.recomputed}
                          {d.recomputedFrom ? <span className="block text-mist-500">{d.recomputedFrom}</span> : null}
                        </td>
                        <td className="px-2 py-1.5">
                          <Badge tone={status.tone}>{status.label}</Badge>
                          {d.difference !== null && d.status !== "matches" ? (
                            <span className="mt-1 block text-mist-500">difference {d.difference}</span>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <datalist id="summary-tags">
              {targets.map((t) => (
                <option key={t.path} value={t.path}>
                  {t.label}
                </option>
              ))}
            </datalist>

            {problems.length > 0 ? (
              <ul className="list-disc space-y-0.5 pl-5 text-xs text-red-700">
                {problems.slice(0, 5).map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            ) : null}

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-mist-100 pt-4">
              <p className="max-w-xl text-xs text-mist-600">
                Nothing is used in a calculation until it is committed here. Committed values appear in the Facts
                Ledger with the sheet, the cell or the column range, and the label they came from. An edited value is
                recorded as a correction.
              </p>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={() => void approve()} disabled={submitting || chosen.length === 0 || problems.length > 0}>
                  Approve and push {chosen.length} to facts ledger
                </Button>
              </div>
            </div>
          </div>
        )}
      </Dialog>
    </>
  );
}
