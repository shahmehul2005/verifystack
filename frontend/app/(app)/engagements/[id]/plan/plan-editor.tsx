"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";

type Rating = "low" | "medium" | "high";

export interface FactorDef {
  key: string;
  label: string;
  prompt: string;
}

export interface PlanDraft {
  factors: { key: string; rating: Rating; rationale: string }[];
  sampleRateOverride?: { rate: number; reason: string };
  siteVisitWaiverReason?: string;
  visits: { id: string; plannedFor: string; location: string; scope: string; assignedTo?: string }[];
  notes?: string;
}

/**
 * Edit the verification plan. The assessment (overall risk, sampling rate, site
 * visit recommendation) is computed on the server from what is saved, so what
 * the page shows above this form is always the stored plan, not a client guess.
 */
export function PlanEditor({
  engagementId,
  defs,
  initial,
  latestStatus,
  canApprove,
}: {
  engagementId: string;
  defs: FactorDef[];
  initial: PlanDraft;
  latestStatus: "draft" | "approved" | null;
  canApprove: boolean;
}) {
  const [factors, setFactors] = useState(
    defs.map((d) => {
      const existing = initial.factors.find((f) => f.key === d.key);
      return { key: d.key, rating: existing?.rating ?? ("low" as Rating), rationale: existing?.rationale ?? "" };
    })
  );
  const [override, setOverride] = useState(initial.sampleRateOverride ? String(initial.sampleRateOverride.rate) : "");
  const [overrideReason, setOverrideReason] = useState(initial.sampleRateOverride?.reason ?? "");
  const [waiver, setWaiver] = useState(initial.siteVisitWaiverReason ?? "");
  const [visits, setVisits] = useState(initial.visits);
  const [notes, setNotes] = useState(initial.notes ?? "");
  const [pending, setPending] = useState(false);

  function content(): PlanDraft {
    const rate = Number(override);
    return {
      // A factor left blank is not rated; the server then says which ones are missing.
      factors: factors.filter((f) => f.rationale.trim().length > 0),
      ...(override && Number.isFinite(rate) ? { sampleRateOverride: { rate, reason: overrideReason } } : {}),
      ...(waiver.trim() ? { siteVisitWaiverReason: waiver.trim() } : {}),
      visits: visits.filter((v) => v.location.trim() && v.scope.trim()),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
    };
  }

  async function send(action: "save" | "approve") {
    setPending(true);
    const res = await fetch("/api/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(action === "save" ? { engagementId, action, content: content() } : { engagementId, action }),
    });
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; version?: number };
    setPending(false);
    if (!res.ok || !json.ok) {
      toast.error(json.error ?? "Could not save the plan");
      return;
    }
    toast.success(action === "approve" ? `Plan v${json.version} approved` : `Saved as v${json.version}`);
    window.location.reload();
  }

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        {defs.map((d, i) => (
          <div key={d.key} className="grid gap-2 sm:grid-cols-[14rem_7rem_1fr]">
            <div>
              <Label className="mb-0">{d.label}</Label>
              <p className="text-xs text-mist-500">{d.prompt}</p>
            </div>
            <Select
              aria-label={`${d.label} rating`}
              value={factors[i]!.rating}
              onChange={(e) =>
                setFactors(factors.map((f, j) => (j === i ? { ...f, rating: e.target.value as Rating } : f)))
              }
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </Select>
            <Input
              aria-label={`${d.label} reason`}
              placeholder="Why this rating (at least 5 characters)"
              value={factors[i]!.rationale}
              onChange={(e) =>
                setFactors(factors.map((f, j) => (j === i ? { ...f, rationale: e.target.value } : f)))
              }
            />
          </div>
        ))}
      </div>

      <div>
        <p className="mb-2 text-[13px] font-medium text-mist-900">Planned site visits</p>
        <div className="space-y-2">
          {visits.map((v, i) => (
            <div key={v.id} className="grid gap-2 sm:grid-cols-[9rem_1fr_1.5fr_auto]">
              <Input
                aria-label="Planned date"
                type="date"
                value={v.plannedFor}
                onChange={(e) => setVisits(visits.map((x, j) => (j === i ? { ...x, plannedFor: e.target.value } : x)))}
              />
              <Input
                aria-label="Location"
                placeholder="Location"
                value={v.location}
                onChange={(e) => setVisits(visits.map((x, j) => (j === i ? { ...x, location: e.target.value } : x)))}
              />
              <Input
                aria-label="Scope"
                placeholder="What will be checked"
                value={v.scope}
                onChange={(e) => setVisits(visits.map((x, j) => (j === i ? { ...x, scope: e.target.value } : x)))}
              />
              <Button
                variant="ghost"
                size="sm"
                aria-label="Remove visit"
                onClick={() => setVisits(visits.filter((_, j) => j !== i))}
              >
                <Trash2 />
              </Button>
            </div>
          ))}
        </div>
        <Button
          className="mt-2"
          variant="secondary"
          size="sm"
          onClick={() =>
            setVisits([...visits, { id: `v${Date.now().toString(36)}`, plannedFor: "", location: "", scope: "" }])
          }
        >
          <Plus /> Add visit
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label>If no site visit is needed, say why</Label>
          <Textarea
            value={waiver}
            onChange={(e) => setWaiver(e.target.value)}
            placeholder="Only if the assessment recommends a visit and you are not planning one."
            className="min-h-20"
          />
        </div>
        <div>
          <Label>Override the sampling rate (optional)</Label>
          <div className="grid grid-cols-[6rem_1fr] gap-2">
            <Input
              aria-label="Rate between 0 and 1"
              placeholder="0.25"
              inputMode="decimal"
              value={override}
              onChange={(e) => setOverride(e.target.value)}
            />
            <Input
              aria-label="Reason for the override"
              placeholder="Reason (at least 10 characters)"
              value={overrideReason}
              onChange={(e) => setOverrideReason(e.target.value)}
            />
          </div>
        </div>
      </div>

      <div>
        <Label>Notes</Label>
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button disabled={pending} onClick={() => void send("save")}>
          Save as new version
        </Button>
        {canApprove ? (
          <Button
            variant="secondary"
            disabled={pending || latestStatus !== "draft"}
            onClick={() => void send("approve")}
          >
            Approve latest saved version
          </Button>
        ) : null}
      </div>
    </div>
  );
}
