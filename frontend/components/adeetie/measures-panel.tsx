"use client";

import { useSoftReload } from "@/lib/soft-reload";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Table, Td, Th } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Plus, Trash2 } from "lucide-react";
import { formatINR } from "@verifystack/backend/domain/packs/adeetie";
import { formatIn } from "@/lib/format";

export interface MeasureRow {
  id: string;
  description: string;
  projected_annual_saving: number;
  saving_unit: string;
  capital_cost_inr: number;
  basis: string;
  annual_cost_saving_inr?: number | null;
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
  const { softReload, isRefreshing } = useSoftReload();
  const [pending, setPending] = useState(false);
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState("");
  const [cost, setCost] = useState("");
  const [basis, setBasis] = useState("");
  const [rupeeSaving, setRupeeSaving] = useState("");

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
        ...(rupeeSaving.trim() !== "" ? { annualCostSavingINR: Number(rupeeSaving) } : {}),
      }),
    });
    const json = await res.json();
    setPending(false);
    if (!res.ok || !json.ok) {
      toast.error(json.error ?? "Could not add measure");
      return;
    }
    toast.success("Measure recorded");
    softReload();
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
    softReload();
  }

  return (
    <Card className="mb-8">
      <CardHeader
        title="Energy conservation measures"
        description="Identified at IGEA and costed in the DPR. Projected savings are estimates; the scheme's 10% gate is decided on the measured M&V SEC, not on this list."
        actions={locked ? <Badge>Locked during M&amp;V</Badge> : undefined}
      />
      <CardBody>
      {measures.length ? (
        <Table>
          <thead>
            <tr>
              <Th>Measure</Th>
              <Th className="text-right">Projected saving / year</Th>
              <Th className="text-right">Capital cost</Th>
              <Th className="text-right">Saving in rupees / year</Th>
              <Th>Basis</Th>
              <Th>
                <span className="sr-only">Actions</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {measures.map((m) => (
              <tr key={m.id}>
                <Td className="font-medium text-mist-900">{m.description}</Td>
                <Td className="whitespace-nowrap text-right tabular">
                  {formatIn(Number(m.projected_annual_saving))}{" "}
                  <span className="text-xs text-mist-500">{m.saving_unit}</span>
                </Td>
                <Td className="whitespace-nowrap text-right tabular">{formatINR(Number(m.capital_cost_inr))}</Td>
                <Td className="whitespace-nowrap text-right tabular">
                  {m.annual_cost_saving_inr == null ? (
                    <span className="text-xs text-mist-400">Not recorded</span>
                  ) : (
                    formatINR(Number(m.annual_cost_saving_inr))
                  )}
                </Td>
                <Td className="text-xs text-mist-600">{m.basis}</Td>
                <Td className="text-right">
                  {locked ? null : (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-red-700 hover:bg-red-50 hover:text-red-800"
                      disabled={pending || isRefreshing}
                      onClick={() => void remove(m.id)}
                    >
                      <Trash2 />
                      Remove
                    </Button>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : (
        <p className="text-[13px] text-mist-600">No measures recorded yet.</p>
      )}
      {locked ? null : (
        <div className="mt-5 grid gap-4 border-t border-mist-100 pt-5 sm:grid-cols-2">
          <p className="text-sm font-medium text-mist-900 sm:col-span-2">Add a measure</p>
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
            <Label htmlFor="m-rupee">Value of the saving in rupees per year (optional)</Label>
            <Input
              id="m-rupee"
              type="number"
              min={0}
              step="1"
              value={rupeeSaving}
              onChange={(e) => setRupeeSaving(e.target.value)}
            />
            <p className="mt-1.5 text-xs text-mist-500">
              From the tariff or fuel price in the basis below. Without it, payback is not computed rather than estimated.
            </p>
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="m-basis">Basis (quotation, vendor guarantee, audit estimate)</Label>
            <Input id="m-basis" value={basis} onChange={(e) => setBasis(e.target.value)} />
          </div>
          <div>
            <Button disabled={pending || isRefreshing} onClick={() => void add()}>
              <Plus />
              Add measure
            </Button>
          </div>
        </div>
      )}
      </CardBody>
    </Card>
  );
}
