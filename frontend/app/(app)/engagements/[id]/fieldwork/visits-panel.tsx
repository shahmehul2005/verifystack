"use client";

import { useSoftReload } from "@/lib/soft-reload";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";

export interface Member {
  userId: string;
  name: string;
}

export interface Suggestion {
  plannedFor: string;
  location: string;
  scope: string;
}

/** Schedule a site visit, starting from one the approved plan already calls for. */
export function ScheduleVisit({
  engagementId,
  members,
  suggestions,
}: {
  engagementId: string;
  members: Member[];
  suggestions: Suggestion[];
}) {
  const { softReload, isRefreshing } = useSoftReload();
  const [plannedFor, setPlannedFor] = useState("");
  const [location, setLocation] = useState("");
  const [scope, setScope] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [pending, setPending] = useState(false);

  async function submit() {
    setPending(true);
    const res = await fetch("/api/fieldwork/visits", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        engagementId,
        plannedFor,
        location,
        scope,
        assignedTo: assignedTo || undefined,
      }),
    });
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    setPending(false);
    if (!res.ok || !json.ok) {
      toast.error(json.error ?? "Could not schedule the visit");
      return;
    }
    toast.success("Visit scheduled");
    softReload();
  }

  return (
    <div>
      {suggestions.length > 0 ? (
        <div className="mb-3 flex flex-wrap gap-2">
          {suggestions.map((s, i) => (
            <Button
              key={i}
              size="sm"
              variant="subtle"
              onClick={() => {
                setPlannedFor(s.plannedFor);
                setLocation(s.location);
                setScope(s.scope);
              }}
            >
              From plan: {s.location}
            </Button>
          ))}
        </div>
      ) : null}
      <form
        className="grid gap-3 sm:grid-cols-[9rem_1fr_1.5fr_12rem_auto]"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div>
          <Label>Date</Label>
          <Input type="date" value={plannedFor} onChange={(e) => setPlannedFor(e.target.value)} />
        </div>
        <div>
          <Label>Location</Label>
          <Input value={location} onChange={(e) => setLocation(e.target.value)} />
        </div>
        <div>
          <Label>Scope</Label>
          <Input value={scope} onChange={(e) => setScope(e.target.value)} placeholder="What will be checked" />
        </div>
        <div>
          <Label>Assigned to</Label>
          <Select value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)}>
            <option value="">Anyone</option>
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex items-end">
          <Button type="submit" disabled={pending || isRefreshing || location.trim().length < 2 || scope.trim().length < 5}>
            Schedule
          </Button>
        </div>
      </form>
    </div>
  );
}

/** Mark a visit finished or cancelled. */
export function VisitStatusButtons({
  engagementId,
  visitId,
  status,
}: {
  engagementId: string;
  visitId: string;
  status: string;
}) {
  const { softReload, isRefreshing } = useSoftReload();
  const [pending, setPending] = useState(false);
  if (status === "completed" || status === "cancelled") return null;

  async function set(next: "completed" | "cancelled") {
    if (!window.confirm(next === "completed" ? "Mark this visit completed?" : "Cancel this visit?")) return;
    setPending(true);
    const res = await fetch("/api/fieldwork/visits", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ engagementId, visitId, status: next }),
    });
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    setPending(false);
    if (!res.ok || !json.ok) {
      toast.error(json.error ?? "Could not update the visit");
      return;
    }
    softReload();
  }

  return (
    <span className="flex gap-1">
      <Button size="sm" variant="secondary" disabled={pending || isRefreshing} onClick={() => void set("completed")}>
        Complete
      </Button>
      <Button size="sm" variant="ghost" disabled={pending || isRefreshing} onClick={() => void set("cancelled")}>
        Cancel
      </Button>
    </span>
  );
}
