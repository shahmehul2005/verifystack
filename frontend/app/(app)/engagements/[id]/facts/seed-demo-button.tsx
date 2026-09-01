"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

interface SeedResponse {
  ok?: boolean;
  seeded?: number;
  enterprise?: boolean;
  measures?: number;
  error?: string;
  message?: string;
}

export function SeedDemoFactsButton({
  engagementId,
  label = "Load Aravalli synthetic facts",
}: {
  engagementId: string;
  label?: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function onClick() {
    setPending(true);
    const res = await fetch(`/api/engagements/${engagementId}/seed-demo`, { method: "POST" });
    const json = (await res.json()) as SeedResponse;
    setPending(false);
    if (!json.ok) {
      toast.error(json.error ?? "Could not seed demo facts");
      return;
    }
    if (!json.seeded && !json.measures && !json.enterprise) {
      toast.success(json.message ?? "Demo facts already present.");
      router.refresh();
      return;
    }
    const parts: string[] = [];
    if (json.seeded) parts.push(`${json.seeded} fact${json.seeded === 1 ? "" : "s"}`);
    if (json.measures) parts.push(`${json.measures} measures`);
    if (json.enterprise) parts.push("enterprise context");
    toast.success(`Seeded ${parts.join(", ")}. Run the calculation next.`);
    router.refresh();
  }

  return (
    <Button size="sm" variant="secondary" disabled={pending} onClick={() => void onClick()}>
      {pending ? "Seeding…" : label}
    </Button>
  );
}
