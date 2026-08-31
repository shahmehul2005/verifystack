"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export function DraftModeToggle({
  engagementId,
  draftMode,
}: {
  engagementId: string;
  draftMode: boolean;
}) {
  const [pending, setPending] = useState(false);

  async function setDraft(next: boolean) {
    setPending(true);
    const res = await fetch(`/api/engagements/${engagementId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draftMode: next }),
    });
    const json = await res.json();
    setPending(false);
    if (!res.ok || !json.ok) {
      toast.error(json.error ?? "Could not change draft mode");
      return;
    }
    toast.success(next ? "Draft mode on — unverified factors allowed" : "Draft mode off — unverified factors will be refused");
    window.location.reload();
  }

  if (draftMode) {
    return (
      <Button variant="secondary" disabled={pending} onClick={() => void setDraft(false)}>
        Leave draft mode
      </Button>
    );
  }
  return (
    <Button variant="ghost" disabled={pending} onClick={() => void setDraft(true)}>
      Re-enter draft mode
    </Button>
  );
}
