"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { ErrorState } from "@/components/states";

export interface PromotableFactor {
  id: string;
  vintage: string;
  label: string;
  value: number;
  unit: string;
}

export function FactorVerifyPanel({ factors }: { factors: PromotableFactor[] }) {
  const [key, setKey] = useState(`${factors[0].id}::${factors[0].vintage}`);
  const [citedSource, setCitedSource] = useState("");
  const [correctedValue, setCorrectedValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const selected = factors.find((f) => `${f.id}::${f.vintage}` === key) ?? factors[0];

  async function submit() {
    setPending(true);
    setError(null);
    const corrected = correctedValue.trim();
    const res = await fetch("/api/factors/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        factorId: selected.id,
        vintage: selected.vintage,
        citedSource,
        correctedValue: corrected === "" ? null : Number(corrected),
      }),
    });
    const json = await res.json();
    setPending(false);
    if (!res.ok || !json.ok) {
      // applyVerifications owns the citation rules; its message is shown verbatim.
      setError(json.error ?? "Verification refused");
      toast.error(json.error ?? "Verification refused");
      return;
    }
    toast.success(`${selected.id} (${selected.vintage}) recorded as verified`);
    window.location.reload();
  }

  return (
    <div className="max-w-2xl space-y-3 border border-stone-200 bg-white p-4">
      <p className="text-[12px] leading-relaxed text-stone-600">
        Record the publication you read the value in — the document, table and edition, not a
        reminder to check it later. A citation that is empty, shorter than twelve characters, or
        still carrying a <span className="font-mono">TO VERIFY</span> marker is refused by the
        domain layer and nothing is written. After you record one, turn draft mode off on the
        engagement and re-run calculation — the engine will use the verified value.
      </p>
      {error ? <ErrorState title="Verification refused" body={error} /> : null}

      <div>
        <Label htmlFor="factor">Factor</Label>
        <select
          id="factor"
          className="h-9 w-full border border-stone-300 bg-white px-2 text-sm"
          value={key}
          onChange={(e) => setKey(e.target.value)}
        >
          {factors.map((f) => (
            <option key={`${f.id}::${f.vintage}`} value={`${f.id}::${f.vintage}`}>
              {f.id} ({f.vintage}) — {f.label}
            </option>
          ))}
        </select>
        <p className="mt-1 text-[11px] text-stone-500">
          Catalogue value {selected.value} {selected.unit}
        </p>
      </div>

      <div>
        <Label htmlFor="cited">Cited source (mandatory)</Label>
        <textarea
          id="cited"
          className="h-24 w-full border border-stone-300 p-2 text-sm"
          value={citedSource}
          onChange={(e) => setCitedSource(e.target.value)}
          placeholder="e.g. IPCC 2006 Guidelines Vol.2 Ch.1 Table 1.4, Coke Oven Coke row, 2006 edition"
        />
      </div>

      <div>
        <Label htmlFor="corrected">
          Value as read from that source (leave blank to confirm {selected.value}{" "}
          {selected.unit})
        </Label>
        <Input
          id="corrected"
          inputMode="decimal"
          value={correctedValue}
          onChange={(e) => setCorrectedValue(e.target.value)}
        />
      </div>

      <Button onClick={() => void submit()} disabled={pending || citedSource.trim().length < 12}>
        Record verification
      </Button>
      <p className="text-[11px] text-stone-500">
        Written to the append-only factor verification log and to the audit trail, against your
        user id.
      </p>
    </div>
  );
}
