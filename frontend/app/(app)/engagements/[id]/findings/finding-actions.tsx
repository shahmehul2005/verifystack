"use client";

import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export function FindingActions({
  findingId,
  engagementId,
}: {
  findingId: string;
  engagementId: string;
}) {
  async function setState(state: string) {
    const res = await fetch("/api/findings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ engagementId, findingId, state }),
    });
    const json = await res.json();
    if (!res.ok || !json.ok) toast.error(json.error ?? "Update failed");
    else {
      toast.success(state);
      window.location.reload();
    }
  }

  async function polish() {
    const res = await fetch("/api/findings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ engagementId, findingId, polish: true }),
    });
    const json = await res.json();
    if (!res.ok || !json.ok) toast.error(json.error ?? "Draft failed");
    else {
      toast.success(json.polished ? "Polished (grounded)" : "Template kept");
      window.location.reload();
    }
  }

  return (
    <div className="mt-2 flex flex-wrap gap-2">
      <Button size="sm" variant="secondary" onClick={() => void polish()}>
        Draft CAR
      </Button>
      <Button size="sm" onClick={() => void setState("accepted")}>
        Accept CAR
      </Button>
      <Button size="sm" variant="ghost" onClick={() => void setState("closed")}>
        Close (clears sign-off)
      </Button>
      <Button size="sm" variant="danger" onClick={() => void setState("rejected")}>
        Reject
      </Button>
      <p className="basis-full text-[11px] text-stone-500">
        Accept CAR keeps a block open. Close or Reject is what allows sign-off.
      </p>
    </div>
  );
}

export function CloseFindingButton({
  findingId,
  engagementId,
}: {
  findingId: string;
  engagementId: string;
}) {
  async function close() {
    const res = await fetch("/api/findings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ engagementId, findingId, state: "closed" }),
    });
    const json = await res.json();
    if (!res.ok || !json.ok) toast.error(json.error ?? "Update failed");
    else {
      toast.success("closed");
      window.location.reload();
    }
  }
  return (
    <Button size="sm" variant="secondary" onClick={() => void close()}>
      Close
    </Button>
  );
}
