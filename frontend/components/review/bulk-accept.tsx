"use client";

import { useSoftReload } from "@/lib/soft-reload";

import { useState } from "react";
import { toast } from "sonner";
import { CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Accept the low-risk values outside the review sample. The button only enables
 * when the server-computed plan allows it, and the server recomputes the plan
 * again on submit: this component is a convenience, not the control.
 */
export function BulkAcceptButton({
  engagementId,
  count,
  disabled,
}: {
  engagementId: string;
  count: number;
  disabled: boolean;
}) {
  const { softReload, isRefreshing } = useSoftReload();
  const [pending, setPending] = useState(false);

  async function run() {
    if (
      !window.confirm(
        `Accept ${count} low-risk value(s) as facts without reading each one? This is recorded against your name and reported to the reviewer.`
      )
    ) {
      return;
    }
    setPending(true);
    const res = await fetch("/api/facts/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ engagementId, expectedCount: count }),
    });
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; accepted?: number };
    setPending(false);
    if (!res.ok || !json.ok) {
      toast.error(json.error ?? "Bulk accept failed");
      return;
    }
    toast.success(`${json.accepted} value(s) accepted`);
    softReload();
  }

  return (
    <Button size="sm" disabled={disabled || pending || isRefreshing} onClick={() => void run()}>
      <CheckCheck />
      {pending ? "Accepting…" : `Accept ${count} low-risk value${count === 1 ? "" : "s"}`}
    </Button>
  );
}
