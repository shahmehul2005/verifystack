"use client";

import { useSoftReload } from "@/lib/soft-reload";

import { useState } from "react";
import { toast } from "sonner";
import { ClipboardCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FieldHint, Label, Textarea } from "@/components/ui/input";

type Decision = "approved" | "changes_requested";

export function ReviewForm({ engagementId }: { engagementId: string }) {
  const { softReload, isRefreshing } = useSoftReload();
  const [decision, setDecision] = useState<Decision>("approved");
  const [comments, setComments] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);

  async function submit() {
    setPending(true);
    const res = await fetch("/api/technical-review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ engagementId, decision, comments }),
    });
    const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    setPending(false);
    setConfirming(false);
    if (!res.ok || !json?.ok) toast.error(json?.error ?? "Review refused");
    else {
      toast.success(decision === "approved" ? "Review approved" : "Changes requested");
      softReload();
    }
  }

  return (
    <div className="space-y-4">
      <fieldset className="space-y-2">
        <legend className="mb-1.5 text-[13px] font-medium text-mist-800">Your decision</legend>
        {(
          [
            ["approved", "Approve", "The facts, calculation and findings are sound as they stand."],
            ["changes_requested", "Request changes", "Sign-off stays blocked until the work is changed and reviewed again."],
          ] as const
        ).map(([value, label, hint]) => (
          <label
            key={value}
            className="flex cursor-pointer items-start gap-3 rounded-md border border-mist-200 bg-white px-3 py-2.5 has-[:checked]:border-teal-600 has-[:checked]:bg-teal-50/50"
          >
            <input
              type="radio"
              name="decision"
              value={value}
              checked={decision === value}
              onChange={() => setDecision(value)}
              className="mt-1 accent-teal-700"
            />
            <span>
              <span className="block text-sm font-medium text-mist-900">{label}</span>
              <span className="block text-[13px] text-mist-600">{hint}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <div>
        <Label htmlFor="review-comments">
          {decision === "approved" ? "What you checked" : "What needs to change"}
        </Label>
        <Textarea
          id="review-comments"
          value={comments}
          onChange={(e) => setComments(e.target.value)}
          maxLength={8000}
          rows={6}
        />
        <FieldHint>This is kept with the review and shown to the lead verifier.</FieldHint>
      </div>

      <Button onClick={() => setConfirming(true)} disabled={comments.trim().length === 0}>
        <ClipboardCheck />
        Record review
      </Button>

      <Dialog open={confirming} onClose={() => setConfirming(false)} title="Record this review?">
        <p className="text-sm leading-relaxed text-mist-700">
          Your decision is tied to the facts and calculation as they are now. If either changes, it
          stops counting and a new review is needed. Reviews cannot be edited or removed.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setConfirming(false)} disabled={pending || isRefreshing}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={pending || isRefreshing}>
            {pending ? "Recording…" : "Record review"}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
