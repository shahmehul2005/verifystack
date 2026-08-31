"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export function SeedDemoFactsButton({ engagementId }: { engagementId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function onClick() {
    setPending(true);
    const res = await fetch(`/api/engagements/${engagementId}/seed-demo`, { method: "POST" });
    const json = (await res.json()) as { ok?: boolean; seeded?: number; error?: string; message?: string };
    setPending(false);
    if (!json.ok) {
      toast.error(json.error ?? "Could not seed demo facts");
      return;
    }
    toast.success(
      json.seeded
        ? `Seeded ${json.seeded} Aravalli facts. Run calculation next.`
        : (json.message ?? "Demo facts already present.")
    );
    router.refresh();
  }

  return (
    <Button size="sm" variant="secondary" disabled={pending} onClick={() => void onClick()}>
      {pending ? "Seeding…" : "Load Aravalli synthetic facts"}
    </Button>
  );
}
