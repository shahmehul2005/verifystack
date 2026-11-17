"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useSoftReload } from "@/lib/soft-reload";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import type { AcceptanceDeclaration } from "@verifystack/backend/domain/engagements/acceptance";

interface Props {
  engagementId: string;
  initial: Partial<AcceptanceDeclaration>;
}

function Check({
  checked,
  onChange,
  children,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  children: React.ReactNode;
  hint: string;
}) {
  return (
    <label className="flex items-start gap-2 text-[13px]">
      <input type="checkbox" className="mt-1" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <span className="font-medium text-mist-900">{children}</span>
        <span className="block text-xs text-mist-500">{hint}</span>
      </span>
    </label>
  );
}

/**
 * Record the engagement acceptance declaration. The outcome is computed on the server from what is sent,
 * and each save is a new immutable version, so the page above always shows what is stored.
 */
export function AcceptanceForm({ engagementId, initial }: Props) {
  const { softReload, isRefreshing } = useSoftReload();
  const [advised, setAdvised] = useState(initial.advisedOnMonitoringPlan ?? false);
  const [relationship, setRelationship] = useState(initial.relationshipWithEntity ?? false);
  const [consultancy, setConsultancy] = useState(initial.consultancyOwnershipLink ?? false);
  const [other, setOther] = useState(initial.otherImpartialityThreat ?? false);
  const [safeguards, setSafeguards] = useState(initial.safeguards ?? "");
  const [inName, setInName] = useState(initial.contractInAgencyName ?? false);
  const [reference, setReference] = useState(initial.contractReference ?? "");
  const [justification, setJustification] = useState(initial.contractReviewJustification ?? "");
  const [inScope, setInScope] = useState(initial.sectorInAccreditedScope ?? false);
  const [pending, setPending] = useState(false);

  async function save() {
    setPending(true);
    const res = await fetch("/api/acceptance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        engagementId,
        declaration: {
          advisedOnMonitoringPlan: advised,
          relationshipWithEntity: relationship,
          consultancyOwnershipLink: consultancy,
          otherImpartialityThreat: other,
          ...(safeguards.trim() ? { safeguards: safeguards.trim() } : {}),
          contractInAgencyName: inName,
          contractReference: reference,
          contractReviewJustification: justification,
          sectorInAccreditedScope: inScope,
        },
      }),
    });
    const json = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      version?: number;
      outcome?: string;
    };
    setPending(false);
    if (!res.ok || !json.ok) {
      toast.error(json.error ?? "Could not record the declaration");
      return;
    }
    if (json.outcome === "cleared") toast.success(`Acceptance v${json.version} cleared`);
    else toast.warning(`Acceptance v${json.version} recorded, but it blocks sign-off`);
    softReload();
  }

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <p className="text-[13px] font-medium text-mist-900">Impartiality</p>
        <Check checked={advised} onChange={setAdvised} hint="ACVA accreditation procedure 5.5.9. If yes, the agency should not verify this entity.">
          The agency advised on this entity&apos;s monitoring and reporting, or helped develop its monitoring plan
        </Check>
        <Check checked={consultancy} onChange={setConsultancy} hint="5.5.10. If yes, the agency should decline.">
          The agency shares ownership with a consultancy that works for this entity
        </Check>
        <Check
          checked={relationship}
          onChange={setRelationship}
          hint="5.5.8: ownership, governance, finances, management, resources, contracts or markets."
        >
          The agency has another relationship with the entity that could threaten impartiality
        </Check>
        <Check checked={other} onChange={setOther} hint="5.5.2 and 5.5.5: commercial, financial or other.">
          Any other threat to impartiality has been identified
        </Check>
        <div>
          <Label>How a declared threat is eliminated or minimised</Label>
          <Textarea
            value={safeguards}
            onChange={(e) => setSafeguards(e.target.value)}
            placeholder="Needed if a relationship or other threat is ticked (at least 20 characters)."
            className="min-h-20"
          />
        </div>
      </div>

      <div className="space-y-3">
        <p className="text-[13px] font-medium text-mist-900">Contract and scope</p>
        <Check checked={inName} onChange={setInName} hint="6.6.2. Legally enforceable and in the agency's name.">
          The contract with the entity is in the name of the agency
        </Check>
        <div className="grid gap-3 sm:grid-cols-[14rem_1fr]">
          <div>
            <Label>Contract reference</Label>
            <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Contract or work order no." />
          </div>
          <div>
            <Label>Why the agency took this engagement (contract review)</Label>
            <Textarea
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
              placeholder="6.6.3. At least 20 characters."
              className="min-h-20"
            />
          </div>
        </div>
        <Check checked={inScope} onChange={setInScope} hint="3.5. The agency is accredited for this sector scope.">
          The sector is inside the agency&apos;s accredited scope
        </Check>
      </div>

      <Button disabled={pending || isRefreshing} onClick={() => void save()}>
        Record declaration
      </Button>
    </div>
  );
}