"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";

export function DprFinanceForm({
  engagementId,
  loanAmountInr,
  projectCostInr,
  sanctionedInterestRatePct,
  locked,
}: {
  engagementId: string;
  loanAmountInr: number | null;
  projectCostInr: number | null;
  sanctionedInterestRatePct: number | null;
  locked: boolean;
}) {
  const [pending, setPending] = useState(false);
  const [loan, setLoan] = useState(loanAmountInr == null ? "" : String(loanAmountInr));
  const [cost, setCost] = useState(projectCostInr == null ? "" : String(projectCostInr));
  const [rate, setRate] = useState(
    sanctionedInterestRatePct == null ? "" : String(sanctionedInterestRatePct)
  );

  async function save() {
    setPending(true);
    const res = await fetch(`/api/engagements/${engagementId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        loanAmountInr: loan === "" ? null : Number(loan),
        projectCostInr: cost === "" ? null : Number(cost),
        sanctionedInterestRatePct: rate === "" ? null : Number(rate),
      }),
    });
    const json = await res.json();
    setPending(false);
    if (!res.ok || !json.ok) {
      toast.error(json.error ?? "Could not save loan structure");
      return;
    }
    toast.success("Loan structure saved");
    window.location.reload();
  }

  return (
    <section className="mb-8">
      <h2 className="mb-2 text-[11px] uppercase tracking-wide text-stone-500">
        Loan structure
      </h2>
      <p className="mb-3 max-w-3xl text-[12px] text-stone-600">
        Required to close the DPR pass. Amounts are rupees, never lakh/crore. Eligibility
        windows are rules, not database constraints.
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <Label htmlFor="loan">Loan amount (INR)</Label>
          <Input
            id="loan"
            type="number"
            min={0}
            disabled={locked}
            value={loan}
            onChange={(e) => setLoan(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="cost">Project cost (INR)</Label>
          <Input
            id="cost"
            type="number"
            min={0}
            disabled={locked}
            value={cost}
            onChange={(e) => setCost(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="rate">Sanctioned interest rate (%)</Label>
          <Input
            id="rate"
            type="number"
            min={0}
            step="0.01"
            disabled={locked}
            value={rate}
            onChange={(e) => setRate(e.target.value)}
          />
        </div>
      </div>
      {locked ? null : (
        <div className="mt-3">
          <Button disabled={pending} onClick={() => void save()}>
            Save loan structure
          </Button>
        </div>
      )}
    </section>
  );
}
