"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Table, Td, Th } from "@/components/ui/table";
import { formatINR } from "@verifystack/backend/domain/packs/adeetie";
import { formatIn } from "@/lib/format";

export interface MeasureRow {
  id: string;
  description: string;
  projected_annual_saving: number;
  saving_unit: string;
  capital_cost_inr: number;
  basis: string;
}

export function MeasuresPanel({
  engagementId,
  measures,
  savingUnit,
  locked,
}: {
  engagementId: string;
  measures: MeasureRow[];
  savingUnit: string;
  locked: boolean;
}) {
  const [pending, setPending] = useState(false);
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState("");
  const [cost, setCost] = useState("");
  const [basis, setBasis] = useState("");

  async function add() {
    setPending(true);
    const res = await fetch(`/api/engagements/${engagementId}/measures`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        description,
        projectedAnnualSaving: Number(saving),
        savingUnit,
        capitalCostINR: Number(cost),
        basis,
      }),
    });
    const json = await res.json();
    setPending(false);
    if (!res.ok || !json.ok) {
      toast.error(json.error ?? "Could not add measure");
      return;
    }
    toast.success("Measure recorded");
    window.location.reload();
  }

  async function remove(measureId: string) {
    setPending(true);
    const res = await fetch(
      `/api/engagements/${engagementId}/measures?measureId=${encodeURIComponent(measureId)}`,
      { method: "DELETE" }
    );
    const json = await res.json();
    setPending(false);
    if (!res.ok || !json.ok) {
      toast.error(json.error ?? "Could not remove measure");
      return;
    }
    toast.success("Measure removed");
    window.location.reload();
  }

  return (
    <section className="mb-8">
      <h2 className="mb-2 text-[11px] uppercase tracking-wide text-stone-500">
        Energy conservation measures
      </h2>
      <p className="mb-3 max-w-3xl text-[12px] text-stone-600">
        Identified at IGEA, costed in the DPR. Projected savings are estimates. The scheme
        10% gate is decided on the measured M&amp;V SEC, not on this list.
      </p>
      {measures.length ? (
        <Table>
          <thead>
            <tr>
              <Th>Measure</Th>
              <Th>Projected saving / year</Th>
              <Th>Capex</Th>
              <Th>Basis</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {measures.map((m) => (
              <tr key={m.id}>
                <Td>{m.description}</Td>
                <Td className="tabular">
                  {formatIn(Number(m.projected_annual_saving))} {m.saving_unit}
                </Td>
                <Td className="tabular">{formatINR(Number(m.capital_cost_inr))}</Td>
                <Td className="text-[12px]">{m.basis}</Td>
                <Td>
                  {locked ? null : (
                    <Button
                      variant="secondary"
                      disabled={pending}
                      onClick={() => void remove(m.id)}
                    >
                      Remove
                    </Button>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : (
        <p className="mb-3 text-[13px] text-stone-600">No measures recorded yet.</p>
      )}
      {locked ? (
        <p className="text-[12px] text-stone-500">Measures are locked during M&amp;V.</p>
      ) : (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label htmlFor="m-desc">Description</Label>
            <Input
              id="m-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="m-save">Projected annual saving ({savingUnit})</Label>
            <Input
              id="m-save"
              type="number"
              min={0}
              step="any"
              value={saving}
              onChange={(e) => setSaving(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="m-cost">Capital cost (INR)</Label>
            <Input
              id="m-cost"
              type="number"
              min={0}
              step="1"
              value={cost}
              onChange={(e) => setCost(e.target.value)}
            />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="m-basis">Basis (quotation, vendor guarantee, audit estimate)</Label>
            <Input id="m-basis" value={basis} onChange={(e) => setBasis(e.target.value)} />
          </div>
          <div>
            <Button disabled={pending} onClick={() => void add()}>
              Add measure
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
