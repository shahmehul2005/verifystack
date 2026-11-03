"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { homePathFor } from "@verifystack/backend/lib/auth/capabilities";
import { Button } from "@/components/ui/button";
import { FieldHint, Input, Label } from "@/components/ui/input";
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
      body: JSON.stringify({ firmName: firmName.trim() || undefined, role: "firm_admin" }),
    });
    const json = (await res.json()) as { ok?: boolean; error?: string };
    setPending(false);
    if (!res.ok || !json.ok) {
      setError(json.error ?? "Could not create the firm.");
      return;
    }
    router.refresh();
    window.location.assign(homePathFor("firm_admin"));
  }

  return (
    <form onSubmit={onSubmit} className="mx-auto mt-6 max-w-sm space-y-4 text-left">
      {error ? <ErrorState title="Could not create the firm" body={error} /> : null}
      <div>
        <Label htmlFor="firm">Firm name</Label>
        <Input
          id="firm"
          value={firmName}
          onChange={(e) => setFirmName(e.target.value)}
          placeholder="e.g. Aravalli Verification LLP"
        />
        <FieldHint>
          You will be the firm admin. Invite verifiers from Team; they do not open a second firm.
        </FieldHint>
      </div>
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Creating…" : "Create my firm"}
      </Button>
    </form>
  );
}
