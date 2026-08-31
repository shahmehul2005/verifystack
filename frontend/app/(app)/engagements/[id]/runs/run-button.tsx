"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

type SecPhase = "baseline" | "post_implementation";

const SEC_PHASES: { phase: SecPhase; label: string }[] = [
  { phase: "baseline", label: "Run baseline SEC" },
  { phase: "post_implementation", label: "Run post-implementation SEC" },
];

export function RunCalcButton({
  engagementId,
  method = "GEI",
  allowedSecPhases,
}: {
  engagementId: string;
  method?: "GEI" | "SEC";
  allowedSecPhases?: SecPhase[];
}) {
  const [pending, setPending] = useState<string | null>(null);

  async function run(phase?: SecPhase) {
    setPending(phase ?? "gei");
    const res = await fetch("/api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ engagementId, ...(phase ? { phase } : {}) }),
    });
    const json = await res.json();
    setPending(null);
    if (!res.ok || !json.ok) {
      toast.error(json.error ?? "Run failed");
      return;
    }
    toast.success(`Run ${String(json.run?.input_hash ?? "").slice(0, 12)}…`);
    window.location.reload();
  }

  if (method === "SEC") {
    const phases = SEC_PHASES.filter(
      (p) => !allowedSecPhases || allowedSecPhases.includes(p.phase)
    );
    return (
      <div className="flex flex-wrap gap-2">
        {phases.map((p) => (
          <Button
            key={p.phase}
            variant={p.phase === "baseline" ? "primary" : "secondary"}
            disabled={pending !== null}
            onClick={() => void run(p.phase)}
          >
            {p.label}
          </Button>
        ))}
      </div>
    );
  }

  return (
    <Button disabled={pending !== null} onClick={() => void run()}>
      Run calculation
    </Button>
  );
}
