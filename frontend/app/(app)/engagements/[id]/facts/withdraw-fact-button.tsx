"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSoftReload } from "@/lib/soft-reload";
import { MIN_CHANGE_REASON } from "@verifystack/backend/domain/deskreview/readingChange";

/**
 * Take a fact out of the ledger a run reads. It asks why, and the fact stays on
 * record in the withdrawn list. A replacement comes from a new snip or another
 * accepted value.
 */
export function WithdrawFactButton({ engagementId, factId, label }: { engagementId: string; factId: string; label: string }) {
  const { softReload, isRefreshing } = useSoftReload();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const enough = reason.trim().length >= MIN_CHANGE_REASON;

  async function withdraw() {
    setBusy(true);
    const res = await fetch("/api/facts/withdraw", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ engagementId, factId, reason: reason.trim() }),
    });
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    setBusy(false);
    if (!res.ok || !json.ok) {
      toast.error(json.error ?? "Could not withdraw the fact");
      return;
    }
    toast.success("Withdrawn. It stays in the withdrawn list. Run the calculation again to use the change.");
    setOpen(false);
    setReason("");
    softReload();
  }

  if (!open) {
    return (
      <button type="button" className="text-xs text-mist-600 underline underline-offset-2 hover:text-mist-900" onClick={() => setOpen(true)}>
        Withdraw
      </button>
    );
  }
  return (
    <div className="flex min-w-64 flex-col gap-1.5 text-left">
      <label htmlFor={`withdraw-${factId}`} className="text-[11px] font-medium text-amber-900">
        Why is {label} being withdrawn?
      </label>
      <Input
        id={`withdraw-${factId}`}
        value={reason}
        maxLength={500}
        onChange={(e) => setReason(e.target.value)}
        placeholder={`At least ${MIN_CHANGE_REASON} characters`}
        className="h-7 text-[11px]"
      />
      <div className="flex items-center gap-2">
        <Button size="sm" className="h-7 text-xs" disabled={!enough || busy || isRefreshing} onClick={() => void withdraw()}>
          {busy ? "Withdrawing…" : "Withdraw fact"}
        </Button>
        <button type="button" className="text-xs text-mist-600 underline underline-offset-2" onClick={() => { setOpen(false); setReason(""); }}>
          Cancel
        </button>
      </div>
    </div>
  );
}
