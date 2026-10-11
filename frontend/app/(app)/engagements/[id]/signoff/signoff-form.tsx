"use client";

import { useState } from "react";
import { toast } from "sonner";
import { PenLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FieldHint, Input, Label, Textarea } from "@/components/ui/input";

const ROLE_TITLE: Record<string, string> = {
  lead_verifier: "Lead verifier attestation",
  independent_reviewer: "Independent reviewer attestation",
};

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
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const fieldId = `signoff-${role}`;

  async function submit() {
    setPending(true);
    const res = await fetch("/api/signoff", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ engagementId, attestorName: name, statement, role }),
    });
    const json = await res.json();
    setPending(false);
    setConfirming(false);
    if (!res.ok || !json.ok) toast.error(json.error ?? "Sign-off refused");
    else {
      toast.success("Attestation recorded");
      window.location.reload();
    }
  }

  return (
    <div className="rounded-lg border border-mist-200 bg-white shadow-xs">
      <div className="border-b border-mist-100 px-5 py-4">
        <h2 className="text-[15px] font-semibold text-mist-900">
          {ROLE_TITLE[role] ?? role.replaceAll("_", " ")}
        </h2>
        <p className="mt-0.5 text-[13px] text-mist-600">
          Records your name against the report fingerprint. It is not a legal e-signature.
        </p>
      </div>
      <div className="space-y-4 px-5 py-4">
        <div>
          <Label htmlFor={`${fieldId}-name`}>Full name</Label>
          <Input
            id={`${fieldId}-name`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
            required
          />
          <FieldHint>As it should appear on the working paper.</FieldHint>
        </div>
        <div>
          <Label htmlFor={`${fieldId}-stmt`}>Statement</Label>
          <Textarea
            id={`${fieldId}-stmt`}
            value={statement}
            onChange={(e) => setStatement(e.target.value)}
          />
        </div>
        <Button onClick={() => setConfirming(true)} disabled={!name.trim()}>
          <PenLine />
          Record attestation
        </Button>
      </div>

      <Dialog open={confirming} onClose={() => setConfirming(false)} title="Record this attestation?">
        <p className="text-sm leading-relaxed text-mist-700">
          Your name, <span className="font-medium text-mist-950">{name}</span>, will be fixed against
          the latest calculation run. Attestations cannot be edited or removed afterwards.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setConfirming(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={pending}>
            {pending ? "Recording…" : "Record attestation"}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
