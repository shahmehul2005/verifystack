"use client";

import { useSoftReload } from "@/lib/soft-reload";

import { useState } from "react";
import { toast } from "sonner";
import { Calculator } from "lucide-react";
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
  const { softReload, isRefreshing } = useSoftReload();
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
    toast.success("Run recorded", {
      description: `Input fingerprint ${String(json.run?.input_hash ?? "").slice(0, 12)}…`,
    });
    softReload();
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
            disabled={pending !== null || isRefreshing}
            onClick={() => void run(p.phase)}
          >
            {pending === p.phase ? <Spinner /> : <Calculator />}
            {pending === p.phase ? "Running…" : p.label}
          </Button>
        ))}
      </div>
    );
  }

  return (
    <Button disabled={pending !== null || isRefreshing} onClick={() => void run()}>
      {pending ? <Spinner /> : <Calculator />}
      {pending ? "Running…" : "Run calculation"}
    </Button>
  );
}

function Spinner() {
  return <span className="size-4 animate-spin rounded-full border-2 border-current/30 border-t-current" />;
}
