"use client";

import { useSoftReload } from "@/lib/soft-reload";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { FieldHint, Input, Label, Select, Textarea } from "@/components/ui/input";
import { ErrorState } from "@/components/states";

export interface PromotableFactor {
  id: string;
  vintage: string;
  label: string;
  value: number;
  unit: string;
}

export function FactorVerifyPanel({
  factors,
  canChangeValue = false,
}: {
  factors: PromotableFactor[];
  /** Platform stewards may replace a catalogue value; firms attest the shipped one. */
  canChangeValue?: boolean;
}) {
  const { softReload, isRefreshing } = useSoftReload();
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
        correctedValue: !canChangeValue || corrected === "" ? null : Number(corrected),
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
    softReload();
  }

  return (
    <div className="max-w-2xl space-y-4 rounded-lg border border-mist-200 bg-white p-5 shadow-xs">
      <p className="text-[13px] leading-relaxed text-mist-600">
        Record the publication you read the value in: the document, table and edition, not a
        reminder to check it later. A citation that is empty, shorter than twelve characters, or
        still carries a <span className="font-mono">TO VERIFY</span> marker is refused and nothing
        is written. Re-run the calculation after a correction so engagements pick up the new value.
      </p>
      {error ? <ErrorState title="Verification refused" body={error} /> : null}

      <div>
        <Label htmlFor="factor">Factor</Label>
        <Select id="factor" value={key} onChange={(e) => setKey(e.target.value)}>
          {factors.map((f) => (
            <option key={`${f.id}::${f.vintage}`} value={`${f.id}::${f.vintage}`}>
              {f.id} ({f.vintage}) — {f.label}
            </option>
          ))}
        </Select>
        <FieldHint>
          Catalogue value{" "}
          <span className="font-mono tabular">
            {selected.value} {selected.unit}
          </span>
        </FieldHint>
      </div>

      <div>
        <Label htmlFor="cited">Cited source</Label>
        <Textarea
          id="cited"
          rows={4}
          required
          value={citedSource}
          onChange={(e) => setCitedSource(e.target.value)}
          placeholder="e.g. IPCC 2006 Guidelines Vol.2 Ch.1 Table 1.4, Coke Oven Coke row, 2006 edition"
        />
        <FieldHint>Required. At least twelve characters.</FieldHint>
      </div>

      {canChangeValue ? (
        <div>
          <Label htmlFor="corrected">
            Catalogue value as read from that source (leave blank to confirm {selected.value}{" "}
            {selected.unit})
          </Label>
          <Input
            id="corrected"
            inputMode="decimal"
            value={correctedValue}
            onChange={(e) => setCorrectedValue(e.target.value)}
          />
          <FieldHint>
            You are recognised as a platform steward, so this writes a new value. Everything else
            on the platform reads the catalogue you are editing.
          </FieldHint>
        </div>
      ) : (
        <p className="rounded-md border border-mist-200 bg-mist-50 px-3 py-2 text-xs leading-relaxed text-mist-600">
          You are attesting the catalogue value of{" "}
          <span className="font-mono">
            {selected.value} {selected.unit}
          </span>
          , not replacing it. The published figure is the same for every firm, so a firm-local
          override would let the unverified-factor control be satisfied by assertion. If this value
          disagrees with the publication in front of you, stop and report it — the catalogue is
          wrong for everyone, not just for you.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3 border-t border-mist-100 pt-4">
        <Button onClick={() => void submit()} disabled={pending || isRefreshing || citedSource.trim().length < 12}>
          {pending ? "Recording…" : "Record attestation"}
        </Button>
        <p className="text-xs text-mist-500">
          Written to the append-only factor verification log and the audit trail, under your user
          id.
        </p>
      </div>
    </div>
  );
}
