"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useSoftReload } from "@/lib/soft-reload";

/**
 * Take an uploaded file back out of the engagement. The server decides whether
 * it may go (nothing accepted may rest on it) and says why when it may not.
 */
export function RemoveButton({
  documentId,
  filename,
  disabledReason,
}: {
  documentId: string;
  filename: string;
  /** Set when the page already knows the file cannot go, so the button explains instead of failing. */
  disabledReason?: string;
}) {
  const { softReload, isRefreshing } = useSoftReload();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function remove() {
    setBusy(true);
    const res = await fetch(`/api/documents/${documentId}`, { method: "DELETE" });
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    setBusy(false);
    if (!res.ok || !json.ok) {
      toast.error(json.error ?? "Could not remove the document");
      return;
    }
    setOpen(false);
    toast.success(`Removed ${filename}`);
    softReload();
  }

  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        aria-label={`Remove ${filename}`}
        title={disabledReason ?? "Remove this file"}
        disabled={Boolean(disabledReason) || isRefreshing}
        onClick={() => setOpen(true)}
      >
        <Trash2 />
        Remove
      </Button>
      <Dialog open={open} onClose={() => (busy ? undefined : setOpen(false))} title="Remove this file?">
        <p className="break-all text-sm font-medium text-mist-900">{filename}</p>
        <p className="mt-2 text-sm text-mist-700">
          The file, its pages and any suggested fields not yet reviewed are deleted from this engagement. This cannot be
          undone. The removal is recorded in the audit log with the file&apos;s name and fingerprint.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" disabled={busy} onClick={() => setOpen(false)}>
            Keep file
          </Button>
          <Button variant="danger" disabled={busy} onClick={() => void remove()}>
            {busy ? "Removing…" : "Remove file"}
          </Button>
        </div>
      </Dialog>
    </>
  );
}
