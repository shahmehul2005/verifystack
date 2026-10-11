"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export function QueueActions({
  fieldId,
  engagementId,
}: {
  fieldId: string;
  engagementId: string;
}) {
  const [pending, setPending] = useState(false);

  async function decide(state: "accepted" | "rejected") {
    setPending(true);
    const res = await fetch("/api/facts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ engagementId, extractedFieldId: fieldId, state }),
    });
    const json = await res.json();
    setPending(false);
    if (!res.ok || !json.ok) toast.error(json.error ?? "Review failed");
    else {
      toast.success(state === "accepted" ? "Accepted as a fact" : "Rejected");
      window.location.reload();
    }
  }

  return (
    <div className="flex shrink-0 gap-2">
      <Button size="sm" disabled={pending} onClick={() => void decide("accepted")}>
        <Check />
        Accept
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="text-red-700 hover:bg-red-50 hover:text-red-800"
        disabled={pending}
        onClick={() => void decide("rejected")}
      >
        <X />
        Reject
      </Button>
    </div>
  );
}
