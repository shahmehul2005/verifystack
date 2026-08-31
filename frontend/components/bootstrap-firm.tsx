"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { ErrorState } from "@/components/states";

export function BootstrapFirm() {
  const router = useRouter();
  const [firmName, setFirmName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const res = await fetch("/api/bootstrap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ firmName: firmName.trim() || undefined }),
    });
    const json = (await res.json()) as { ok?: boolean; error?: string };
    setPending(false);
    if (!res.ok || !json.ok) {
      setError(json.error ?? "Could not create the firm.");
      return;
    }
    router.refresh();
    window.location.assign("/engagements");
  }

  return (
    <form onSubmit={onSubmit} className="mx-auto mt-6 max-w-sm space-y-3 text-left">
      {error ? <ErrorState body={error} /> : null}
      <div>
        <Label htmlFor="firm">Firm name</Label>
        <Input
          id="firm"
          value={firmName}
          onChange={(e) => setFirmName(e.target.value)}
          placeholder="e.g. Aravalli Verification LLP"
        />
      </div>
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Creating…" : "Create my firm"}
      </Button>
    </form>
  );
}
