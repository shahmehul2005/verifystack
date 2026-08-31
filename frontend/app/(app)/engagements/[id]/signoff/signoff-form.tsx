"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";

export function SignoffForm({
  engagementId,
  role,
}: {
  engagementId: string;
  role: string;
}) {
  const [name, setName] = useState("");
  const [statement, setStatement] = useState(
    "I attest that I have reviewed the evidence, facts, calculation run, and findings for this engagement."
  );

  async function submit() {
    const res = await fetch("/api/signoff", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ engagementId, attestorName: name, statement, role }),
    });
    const json = await res.json();
    if (!res.ok || !json.ok) toast.error(json.error ?? "Sign-off refused");
    else {
      toast.success("Attestation recorded");
      window.location.reload();
    }
  }

  return (
    <div className="max-w-lg space-y-3 border border-stone-200 bg-white p-4">
      <p className="text-[11px] uppercase tracking-wide text-stone-500">
        Named attestation · {role.replaceAll("_", " ")}
      </p>
      <p className="text-[12px] text-stone-600">
        This records your name against the report hash. It is not a legal e-sign.
      </p>
      <div>
        <Label htmlFor="name">Name as it should appear</Label>
        <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
      </div>
      <div>
        <Label htmlFor="stmt">Statement</Label>
        <textarea
          id="stmt"
          className="h-24 w-full border border-stone-300 p-2 text-sm"
          value={statement}
          onChange={(e) => setStatement(e.target.value)}
        />
      </div>
      <Button onClick={() => void submit()} disabled={!name}>
        Record attestation
      </Button>
    </div>
  );
}
