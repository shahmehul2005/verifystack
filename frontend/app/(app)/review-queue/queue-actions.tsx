"use client";

import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export function QueueActions({
  fieldId,
  engagementId,
}: {
  fieldId: string;
  engagementId: string;
}) {
  async function decide(state: "accepted" | "rejected") {
    const res = await fetch("/api/facts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ engagementId, extractedFieldId: fieldId, state }),
    });
    const json = await res.json();
    if (!res.ok || !json.ok) toast.error(json.error ?? "Review failed");
    else {
      toast.success(state === "accepted" ? "Accepted → D4" : "Rejected");
      window.location.reload();
    }
  }

  return (
    <div className="mt-2 flex gap-2">
      <Button size="sm" onClick={() => void decide("accepted")}>
        Accept → D4
      </Button>
      <Button size="sm" variant="danger" onClick={() => void decide("rejected")}>
        Reject
      </Button>
    </div>
  );
}
