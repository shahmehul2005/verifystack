"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
  const blocked = blockers.length > 0;

  async function advance() {
    setPending(true);
    const res = await fetch(`/api/engagements/${engagementId}/phase`, { method: "POST" });
    const json = await res.json();
    setPending(false);
    if (!res.ok || !json.ok) {
      toast.error(json.error ?? "Could not open the next phase");
      return;
    }
    toast.success(`${ADEETIE_PHASE_SHORT_LABEL[nextPhase]} opened`);
    window.location.reload();
  }

  return (
    <div className="mt-4">
      <Button disabled={pending || blocked} onClick={() => void advance()}>
        Open {ADEETIE_PHASE_SHORT_LABEL[nextPhase]}
      </Button>
      {blocked ? (
        <ul className="mt-2 list-disc space-y-0.5 pl-5 text-[12px] text-amber-950">
          {blockers.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 max-w-2xl text-[12px] text-stone-600">
          Status returns to setup for the new pass. Baseline SEC, findings, and IGEA
          attestations stay on the engagement; maker-checker starts again for this phase.
        </p>
      )}
    </div>
  );
}
