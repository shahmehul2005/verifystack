"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ArrowRight, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { FieldHint, Input, Label, Select } from "@/components/ui/input";
import { Stepper } from "@/components/ui/stepper";

export interface StageOption {
  id: string;
  label: string;
}

export interface StageEventRow {
  id: string;
  from: string | null;
  to: string;
  direction: "forward" | "back";
  note: string | null;
  at: string;
}

export function StageTracker({
  engagementId,
  stages,
  current,
  canMove,
  mismatch,
  events,
}: {
  engagementId: string;
  stages: StageOption[];
  current: string | null;
  canMove: boolean;
  mismatch: string | null;
  events: StageEventRow[];
}) {
  const [busy, setBusy] = useState(false);
  const [backTo, setBackTo] = useState("");
  const [note, setNote] = useState("");

  const idx = current ? stages.findIndex((s) => s.id === current) : -1;
  const next = stages[idx + 1];
  const earlier = stages.slice(0, Math.max(idx, 0));
  const label = (id: string | null) => stages.find((s) => s.id === id)?.label ?? id ?? "Not set";
  const closed = idx === stages.length - 1;

  async function move(stage: string, withNote?: string) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/engagements/${engagementId}/stage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage, ...(withNote ? { note: withNote } : {}) }),
      });
      const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!res.ok || !json?.ok) {
        toast.error(json?.error ?? "The stage could not be changed");
        return;
      }
      toast.success(`Stage: ${label(stage)}`);
      window.location.reload();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mb-6">
      <CardHeader
        title="Stage"
        description="Where this engagement sits in the scheme's journey. It is a tracker for your firm: moving it does not unlock or lock any work."
      />
      <CardBody className="space-y-4">
        <Stepper label="Engagement stage" current={current ?? ""} steps={stages} className="overflow-x-auto" />
        {mismatch ? <p className="text-[13px] text-amber-800">{mismatch}</p> : null}

        {canMove && !closed ? (
          <div className="flex flex-wrap items-end gap-3 border-t border-mist-100 pt-4">
            {next ? (
              <Button size="sm" disabled={busy} onClick={() => void move(next.id)}>
                {current ? `Move to ${next.label}` : `Start at ${next.label}`}
                <ArrowRight />
              </Button>
            ) : null}
            {earlier.length > 0 ? (
              <div className="flex flex-wrap items-end gap-2">
                <div>
                  <Label htmlFor="stage-back">Move back to</Label>
                  <Select id="stage-back" value={backTo} onChange={(e) => setBackTo(e.target.value)} className="w-56">
                    <option value="">Choose a stage</option>
                    {earlier.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label}
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <Label htmlFor="stage-note">Why</Label>
                  <Input id="stage-note" value={note} onChange={(e) => setNote(e.target.value)} className="w-64" maxLength={1000} />
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy || !backTo || note.trim().length < 5}
                  onClick={() => void move(backTo, note.trim())}
                >
                  <Undo2 />
                  Move back
                </Button>
              </div>
            ) : null}
            <FieldHint className="basis-full">Stages move one step forward at a time. Moving back needs a reason.</FieldHint>
          </div>
        ) : null}

        {events.length > 0 ? (
          <ul className="space-y-1 border-t border-mist-100 pt-3 text-xs text-mist-600">
            {events.map((e) => (
              <li key={e.id}>
                <span className="text-mist-500">{e.at}</span> · {label(e.from)} → <span className="font-medium text-mist-800">{label(e.to)}</span>
                {e.direction === "back" ? " (back)" : ""}
                {e.note ? ` — ${e.note}` : ""}
              </li>
            ))}
          </ul>
        ) : null}
      </CardBody>
    </Card>
  );
}
