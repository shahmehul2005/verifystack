"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ADEETIE_PHASE_SHORT_LABEL, type AdeetiePhase } from "@verifystack/backend/domain/packs/adeetie";

export function AdvancePhaseButton({
  engagementId,
  nextPhase,
  blockers,
}: {
  engagementId: string;
  nextPhase: AdeetiePhase;
  blockers: string[];
}) {
  const [pending, setPending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const blocked = blockers.length > 0;
  const label = ADEETIE_PHASE_SHORT_LABEL[nextPhase];

  async function advance() {
    setPending(true);
    const res = await fetch(`/api/engagements/${engagementId}/phase`, { method: "POST" });
    const json = await res.json();
    setPending(false);
    setConfirming(false);
    if (!res.ok || !json.ok) {
      toast.error(json.error ?? "Could not open the next phase");
      return;
    }
    toast.success(`${label} opened`);
    window.location.reload();
  }

  return (
    <div className="mt-4 rounded-lg border border-mist-200 bg-white px-4 py-3.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-medium text-mist-900">Next phase: {label}</p>
        <Button disabled={pending || blocked} onClick={() => setConfirming(true)}>
          Open {label}
          <ArrowRight />
        </Button>
      </div>
      {blocked ? (
        <div className="mt-2">
          <p className="text-xs font-medium text-amber-800">Before you can open it</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-amber-900">
            {blockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="mt-2 max-w-2xl text-xs leading-relaxed text-mist-600">
          Status returns to setup for the new pass. Baseline SEC, findings and IGEA attestations
          stay on the engagement; the two-person sign-off starts again for this phase.
        </p>
      )}

      <Dialog open={confirming} onClose={() => setConfirming(false)} title={`Open ${label}?`}>
        <p className="text-sm leading-relaxed text-mist-700">
          The engagement moves to the {label} phase and its status returns to setup. Phases only
          move forward; this cannot be undone.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setConfirming(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={() => void advance()} disabled={pending}>
            {pending ? "Opening…" : `Open ${label}`}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
