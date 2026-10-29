"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Play, Save } from "lucide-react";
import type { ManualReadingSpec } from "@verifystack/backend/domain/deskreview/engine";
import {
  DECIDABLE_STATES,
  MIN_REASON_LENGTH,
  RESOLUTION_HELP,
  RESOLUTION_LABEL,
  type ResolutionState,
} from "@verifystack/backend/domain/deskreview/resolution";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSoftReload } from "@/lib/soft-reload";

export interface SavedReading {
  key: string;
  value: number;
  documentId: string | null;
  page: number | null;
}

export interface SlotDoc {
  id: string;
  name: string;
  slot: string | null;
}

export function RunDeskReviewButton({ engagementId }: { engagementId: string }) {
  const { softReload, isRefreshing } = useSoftReload();
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    const res = await fetch("/api/desk-review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ engagementId }),
    });
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    setBusy(false);
    if (!res.ok || !json.ok) {
      toast.error(json.error ?? "Could not run the desk review");
      return;
    }
    toast.success("Desk review run");
    softReload();
  }

  return (
    <Button onClick={() => void run()} disabled={busy || isRefreshing}>
      <Play />
      Run desk review
    </Button>
  );
}

type Decidable = (typeof DECIDABLE_STATES)[number];

export interface TriageResolution {
  state: ResolutionState;
  reason: string;
  decidedAt: string;
}

export interface TriageFinding {
  id: string;
  state: string;
  severity: string;
}

/**
 * The verifier's decision on one check. A decision that holds sign-off goes onto
 * the linked finding, where the plant is asked and the answer is verified, so
 * there is one place the question is asked and one place it is closed.
 */
export function TriageBar({
  engagementId,
  ruleId,
  status,
  inherentBlock,
  resolution,
  finding,
  available,
}: {
  engagementId: string;
  ruleId: string;
  status: "fail" | "pending" | "pass" | "not_applicable";
  /** The finding for this check holds sign-off by design, so "immaterial" is not offered. */
  inherentBlock: boolean;
  resolution: TriageResolution | null;
  finding: TriageFinding | null;
  /** False until migration 0019 is applied. */
  available: boolean;
}) {
  const { softReload, isRefreshing } = useSoftReload();
  const [open, setOpen] = useState(false);
  const offered: readonly Decidable[] = status === "pending" ? ["scope_limitation"] : DECIDABLE_STATES;
  const options = offered.filter((s) => !(inherentBlock && s === "unresolved_immaterial"));
  const [state, setState] = useState<Decidable>(
    resolution && resolution.state !== "resolved" ? resolution.state : options[0]!
  );
  const [reason, setReason] = useState(resolution && resolution.state !== "resolved" ? resolution.reason : "");
  const [busy, setBusy] = useState(false);

  const findingLink = finding ? (
    <a
      href={`/engagements/${engagementId}/findings#finding-${finding.id}`}
      className="text-xs font-medium text-teal-700 underline-offset-2 hover:underline"
    >
      Open the finding to query the plant
    </a>
  ) : null;

  async function save() {
    setBusy(true);
    const res = await fetch("/api/desk-review/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ engagementId, ruleId, state, reason: reason.trim() }),
    });
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; blocksSignOff?: boolean };
    setBusy(false);
    if (!res.ok || !json.ok) {
      toast.error(json.error ?? "Could not save the decision");
      return;
    }
    toast.success(json.blocksSignOff ? "Recorded. This holds sign-off." : "Decision recorded");
    setOpen(false);
    softReload();
  }

  const decided = resolution && resolution.state !== "resolved";
  return (
    <div className="mt-2 space-y-2">
      {decided ? (
        <p className="text-xs text-mist-700">
          <span className="font-medium text-mist-900">{RESOLUTION_LABEL[resolution.state]}.</span> {resolution.reason}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" variant={decided ? "ghost" : "secondary"} disabled={!available || isRefreshing} onClick={() => setOpen((v) => !v)}>
          {decided ? "Change decision" : status === "pending" ? "Record a scope limitation" : "Decide"}
        </Button>
        {findingLink}
        {!available ? <span className="text-xs text-mist-500">Apply migration 0019 to record decisions.</span> : null}
      </div>
      {open ? (
        <div className="space-y-2 rounded-md border border-mist-200 bg-mist-50/60 p-3">
          {options.length > 1 ? (
            <select
              aria-label="Resolution"
              className="h-9 w-full rounded-md border border-mist-300 bg-white px-2 text-sm"
              value={state}
              onChange={(e) => setState(e.target.value as Decidable)}
            >
              {options.map((s) => (
                <option key={s} value={s}>
                  {RESOLUTION_LABEL[s]}
                </option>
              ))}
            </select>
          ) : (
            <p className="text-sm font-medium text-mist-900">{RESOLUTION_LABEL[options[0]!]}</p>
          )}
          <p className="text-xs text-mist-600">{RESOLUTION_HELP[state]}</p>
          <textarea
            aria-label="Reason"
            rows={3}
            className="w-full rounded-md border border-mist-300 bg-white px-2 py-1.5 text-sm"
            placeholder="Why. At least 10 characters. This is kept with the finding."
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <div className="flex justify-end">
            <Button size="sm" disabled={busy || reason.trim().length < MIN_REASON_LENGTH} onClick={() => void save()}>
              <Save />
              Save decision
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const DAILY_LINE = /^(\d{4}-\d{2}-\d{2})\s*[,:\s]\s*(-?\d+(?:\.\d+)?)\s*$/;

/**
 * The figures that sit in PDFs. The auditor types each against the document and page
 * it was read from. Workbook figures are never typed here; they are read by code.
 */
export function ReadingsForm({
  engagementId,
  specs,
  saved,
  docs,
}: {
  engagementId: string;
  specs: ManualReadingSpec[];
  saved: SavedReading[];
  docs: SlotDoc[];
}) {
  const { softReload, isRefreshing } = useSoftReload();
  const byKey = new Map(saved.map((s) => [s.key, s]));
  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const s of specs) {
      if (s.kind === "daily") {
        init[s.key] = saved
          .filter((r) => r.key.startsWith(`${s.key}@`))
          .sort((a, b) => a.key.localeCompare(b.key))
          .map((r) => `${r.key.slice(s.key.length + 1)} ${r.value}`)
          .join("\n");
      } else {
        const r = byKey.get(s.key);
        init[s.key] = r ? String(r.value) : "";
      }
    }
    return init;
  });
  const [docOf, setDocOf] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const s of specs) {
      const r = saved.find((x) => x.key === s.key || x.key.startsWith(`${s.key}@`));
      init[s.key] = r?.documentId ?? "";
    }
    return init;
  });
  const [pageOf, setPageOf] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const s of specs) {
      const r = saved.find((x) => x.key === s.key || x.key.startsWith(`${s.key}@`));
      init[s.key] = r?.page ? String(r.page) : "";
    }
    return init;
  });
  const [busy, setBusy] = useState(false);

  async function save() {
    const readings: { key: string; value: number | null; documentId: string | null; page: number | null }[] = [];
    for (const s of specs) {
      const documentId = docOf[s.key] || null;
      const page = pageOf[s.key] ? Number(pageOf[s.key]) : null;
      const text = (values[s.key] ?? "").trim();
      if (s.kind === "daily") {
        const keep = new Set<string>();
        for (const line of text.split(/\r?\n/).filter((l) => l.trim())) {
          const m = DAILY_LINE.exec(line.trim());
          if (!m) {
            toast.error(`"${line.trim()}" is not "YYYY-MM-DD value".`);
            return;
          }
          keep.add(`${s.key}@${m[1]}`);
          readings.push({ key: `${s.key}@${m[1]}`, value: Number(m[2]), documentId, page });
        }
        for (const r of saved) if (r.key.startsWith(`${s.key}@`) && !keep.has(r.key)) readings.push({ key: r.key, value: null, documentId: null, page: null });
      } else if (text === "") {
        if (byKey.has(s.key)) readings.push({ key: s.key, value: null, documentId: null, page: null });
      } else if (!Number.isFinite(Number(text))) {
        toast.error(`"${s.label}" needs a number.`);
        return;
      } else {
        readings.push({ key: s.key, value: Number(text), documentId, page });
      }
    }
    if (readings.length === 0) return;
    setBusy(true);
    const res = await fetch("/api/desk-review/readings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ engagementId, readings }),
    });
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    setBusy(false);
    if (!res.ok || !json.ok) {
      toast.error(json.error ?? "Could not save the readings");
      return;
    }
    toast.success("Readings saved");
    softReload();
  }

  const slots = [...new Set(specs.map((s) => s.slot))];
  return (
    <div className="space-y-5">
      {slots.map((slot) => (
        <div key={slot}>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-mist-500">{slot.replace(/_/g, " ")}</p>
          <div className="divide-y divide-mist-100 rounded-md border border-mist-200">
            {specs
              .filter((s) => s.slot === slot)
              .map((s) => {
                const candidates = docs.filter((d) => d.slot === s.slot);
                return (
                  <div key={s.key} className="grid items-start gap-2 px-3 py-2 md:grid-cols-[1.4fr_1fr_1.2fr_5rem]">
                    <div>
                      <p className="text-sm text-mist-900">{s.label}</p>
                      <p className="font-mono text-[11px] text-mist-500">
                        {s.key} · {s.unit}
                      </p>
                      {s.hint ? <p className="text-[11px] text-mist-500">{s.hint}</p> : null}
                    </div>
                    {s.kind === "daily" ? (
                      <textarea
                        aria-label={s.label}
                        rows={4}
                        className="rounded-md border border-mist-300 bg-white px-2 py-1 font-mono text-xs"
                        placeholder="2023-11-01 400.0"
                        value={values[s.key] ?? ""}
                        onChange={(e) => setValues((v) => ({ ...v, [s.key]: e.target.value }))}
                      />
                    ) : (
                      <Input
                        aria-label={s.label}
                        type="number"
                        step="any"
                        className="h-9 tabular"
                        value={values[s.key] ?? ""}
                        onChange={(e) => setValues((v) => ({ ...v, [s.key]: e.target.value }))}
                      />
                    )}
                    <select
                      aria-label={`Source document for ${s.label}`}
                      className="h-9 rounded-md border border-mist-300 bg-white px-2 text-xs"
                      value={docOf[s.key] ?? ""}
                      onChange={(e) => setDocOf((v) => ({ ...v, [s.key]: e.target.value }))}
                    >
                      <option value="">{candidates.length ? "Source document…" : "No document in this slot"}</option>
                      {candidates.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                    <Input
                      aria-label={`Page for ${s.label}`}
                      type="number"
                      min={1}
                      placeholder="Page"
                      className="h-9 tabular"
                      value={pageOf[s.key] ?? ""}
                      onChange={(e) => setPageOf((v) => ({ ...v, [s.key]: e.target.value }))}
                    />
                  </div>
                );
              })}
          </div>
        </div>
      ))}
      <div className="flex items-center justify-between gap-3">
        <p className="max-w-xl text-xs text-mist-600">
          Leave a figure blank if you have not read it; the checks that need it stay pending. A figure never becomes a
          fact and never feeds a calculation.
        </p>
        <Button variant="secondary" onClick={() => void save()} disabled={busy || isRefreshing}>
          <Save />
          Save readings
        </Button>
      </div>
    </div>
  );
}
