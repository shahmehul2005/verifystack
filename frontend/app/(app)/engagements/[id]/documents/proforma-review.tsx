"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Table2 } from "lucide-react";
import type { ProformaReading, ProformaStatus } from "@verifystack/backend/domain/proforma/reader";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useSoftReload } from "@/lib/soft-reload";

const STATUS: Record<ProformaStatus, { label: string; tone: BadgeTone }> = {
  found: { label: "Read from workbook", tone: "ok" },
  zero: { label: "Zero: stream counts as zero", tone: "neutral" },
  missing: { label: "Row not found", tone: "block" },
  error: { label: "Could not compute", tone: "block" },
  unmapped: { label: "No stream for this", tone: "draft" },
};

/**
 * Read the run's calculation inputs from the master pro forma. The server finds each
 * input by its label, recomputes formulas, and offers the value. Nothing is typed
 * and nothing is read from a PDF. Approved inputs become facts that point at the
 * workbook cell.
 */
export function ProformaReviewButton({
  documentId,
  documentName,
  engagementId,
}: {
  documentId: string;
  documentName: string;
  engagementId: string;
}) {
  const { softReload, isRefreshing } = useSoftReload();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [reading, setReading] = useState<ProformaReading | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [use, setUse] = useState<Record<number, boolean>>({});
  const [values, setValues] = useState<Record<number, string>>({});
  const [submitting, setSubmitting] = useState(false);

  async function openAndLoad() {
    setOpen(true);
    setLoading(true);
    setError(null);
    const res = await fetch(`/api/documents/${documentId}/proforma`);
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; reading?: ProformaReading };
    setLoading(false);
    if (!res.ok || !json.ok || !json.reading) {
      setError(json.error ?? "Could not read the pro forma.");
      return;
    }
    setReading(json.reading);
    setUse(Object.fromEntries(json.reading.drafts.map((d) => [d.index, d.status === "found"])));
    setValues(Object.fromEntries(json.reading.drafts.map((d) => [d.index, d.value === null ? "" : String(d.value)])));
  }

  const chosen = (reading?.drafts ?? []).filter((d) => use[d.index]);
  const bad = chosen.some((d) => values[d.index]?.trim() === "" || !Number.isFinite(Number(values[d.index])));

  async function approve() {
    if (!reading || chosen.length === 0 || bad) return;
    setSubmitting(true);
    const res = await fetch(`/api/documents/${documentId}/proforma`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        engagementId,
        approvals: chosen.map((d) => ({ index: d.index, value: Number(values[d.index]) })),
      }),
    });
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; committed?: number };
    setSubmitting(false);
    if (!res.ok || !json.ok) {
      toast.error(json.error ?? "Could not commit these inputs");
      return;
    }
    toast.success(`${json.committed ?? chosen.length} input(s) committed to the Facts Ledger`);
    setOpen(false);
    softReload();
  }

  return (
    <>
      <Button variant="secondary" size="sm" disabled={isRefreshing} onClick={() => void openAndLoad()} aria-label={`Read pro forma inputs from ${documentName}`}>
        <Table2 />
        Read inputs
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Calculation inputs from the pro forma" className="max-w-5xl">
        {loading ? (
          <p className="text-sm text-mist-600">Reading the workbook and recomputing its formulas…</p>
        ) : error ? (
          <p className="text-sm text-red-700">{error}</p>
        ) : reading ? (
          <div className="space-y-4">
            {reading.staleFormulaCells > 0 ? (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                {reading.staleFormulaCells} formula cell(s) in this file stored a result that differs from what the
                formula computes, usually because the file was generated and never opened in Excel. The values below are
                computed here from the formulas, not read from the stored results.
              </div>
            ) : null}
            {reading.formulaErrors.length > 0 ? (
              <p className="text-xs text-red-700">
                {reading.formulaErrors.length} formula(s) could not be computed, for example {reading.formulaErrors[0]!.sheet}!
                {reading.formulaErrors[0]!.ref}: {reading.formulaErrors[0]!.error}.
              </p>
            ) : null}
            <div className="max-h-[50vh] overflow-auto rounded-md border border-mist-200">
              <table className="min-w-full text-xs">
                <thead className="sticky top-0 bg-mist-100 text-left text-mist-600">
                  <tr>
                    <th className="px-2 py-1.5 font-medium">Use</th>
                    <th className="px-2 py-1.5 font-medium">Input</th>
                    <th className="px-2 py-1.5 font-medium">Becomes tag</th>
                    <th className="px-2 py-1.5 font-medium">Cell</th>
                    <th className="px-2 py-1.5 font-medium">Stored → computed</th>
                    <th className="px-2 py-1.5 font-medium">Value to commit</th>
                    <th className="px-2 py-1.5 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {reading.drafts.map((d) => {
                    const s = STATUS[d.status];
                    const committable = d.fieldPath !== null && d.value !== null;
                    return (
                      <tr key={d.index} className="border-t border-mist-100 align-top">
                        <td className="px-2 py-1.5">
                          <input
                            type="checkbox"
                            aria-label={`Use ${d.label}`}
                            disabled={!committable}
                            checked={Boolean(use[d.index])}
                            onChange={(e) => setUse((u) => ({ ...u, [d.index]: e.target.checked }))}
                          />
                        </td>
                        <td className="px-2 py-1.5">{d.label}</td>
                        <td className="px-2 py-1.5 font-mono">{d.fieldPath ?? "–"}</td>
                        <td className="px-2 py-1.5 font-mono text-mist-700">
                          {d.sheet ? `${d.sheet}!${d.cellRef}` : "–"}
                          {d.formula ? <span className="block text-mist-500">={d.formula}</span> : null}
                        </td>
                        <td className="px-2 py-1.5 font-mono text-mist-700">
                          {d.sheet ? `${d.cachedValue ?? "empty"} → ${d.workbookValue ?? "n/a"}` : "–"}
                          {d.scale !== 1 ? <span className="block text-mist-500">×{d.scale}</span> : null}
                        </td>
                        <td className="px-2 py-1.5">
                          <div className="flex items-center gap-1">
                            <Input
                              aria-label={`Value for ${d.label}`}
                              type="number"
                              step="any"
                              disabled={!committable}
                              className="h-8 w-32 text-xs tabular"
                              value={values[d.index] ?? ""}
                              onChange={(e) => setValues((v) => ({ ...v, [d.index]: e.target.value }))}
                            />
                            <span className="text-mist-500">{d.unit}</span>
                          </div>
                        </td>
                        <td className="px-2 py-1.5">
                          <Badge tone={s.tone}>{s.label}</Badge>
                          {d.note ? <span className="mt-1 block max-w-64 text-mist-500">{d.note}</span> : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-mist-100 pt-4">
              <p className="max-w-xl text-xs text-mist-600">
                An input the workbook leaves at zero is not written; its stream counts as zero. An edited value is
                recorded as a correction. Nothing is used in a calculation until it is committed here.
              </p>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={() => void approve()} disabled={submitting || chosen.length === 0 || bad}>
                  Approve and push {chosen.length} to facts ledger
                </Button>
              </div>
            </div>
          </div>
        ) : null}
      </Dialog>
    </>
  );
}
