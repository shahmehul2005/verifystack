"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Calculator } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Table, Td, Th } from "@/components/ui/table";
import { CopyText } from "@/components/ui/copy-text";
import { formatINR } from "@verifystack/backend/domain/packs/adeetie";
import { formatIn, formatIst } from "@/lib/format";

/** The stored shape of a savings run, as far as this panel reads it. */
export interface SavingsRunView {
  inputHash: string;
  createdAt: string;
  result: {
    engineVersion: string;
    perMeasure: Array<{
      id: string;
      description: string;
      annualEnergySaving: number;
      capitalCostINR: number;
      annualCostSavingINR: number | null;
      simplePaybackYears: number | null;
      paybackNote: string | null;
    }>;
    totals: {
      annualEnergySaving: number;
      energyUnit: string;
      savingsPct: number;
      meetsProjectedThreshold: boolean;
      minSavingsPct: number;
      capitalCostINR: number;
      annualCostSavingINR: number | null;
      simplePaybackYears: number | null;
      measuresMissingCostSaving: number;
    };
    notComputed: string[];
  };
}

const one = (n: number) => formatIn(n, { maximumFractionDigits: 1 });

export function SavingsPanel({
  engagementId,
  latest,
  canRun,
  hasMeasures,
}: {
  engagementId: string;
  latest: SavingsRunView | null;
  canRun: boolean;
  hasMeasures: boolean;
}) {
  const [pending, setPending] = useState(false);

  async function run() {
    setPending(true);
    const res = await fetch(`/api/engagements/${engagementId}/savings`, { method: "POST" });
    const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    setPending(false);
    if (!res.ok || !json?.ok) {
      toast.error(json?.error ?? "Could not compute savings");
      return;
    }
    toast.success("Savings and payback recorded");
    window.location.reload();
  }

  const t = latest?.result.totals;
  return (
    <Card className="mb-8">
      <CardHeader
        title="Savings and simple payback"
        description="A projection from the recorded measures against the baseline. It is recorded and hashed like a run, so a figure on a DPR review can be reproduced."
        actions={
          canRun ? (
            <Button size="sm" disabled={pending || !hasMeasures} onClick={() => void run()}>
              <Calculator />
              {latest ? "Recompute" : "Compute"}
            </Button>
          ) : undefined
        }
      />
      <CardBody className="space-y-4">
        {!latest || !t ? (
          <p className="text-[13px] text-mist-600">
            {hasMeasures
              ? "Not computed yet. It needs a baseline SEC run and the measures above, in the baseline's energy unit."
              : "Record at least one measure first."}
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={t.meetsProjectedThreshold ? "ok" : "draft"} dot>
                {one(t.savingsPct)}% projected, threshold {t.minSavingsPct}%
              </Badge>
              <span className="text-xs text-mist-500">{formatIst(latest.createdAt)}</span>
              <span className="text-xs text-mist-500">
                Fingerprint <CopyText value={latest.inputHash} />
              </span>
            </div>
            <Table>
              <thead>
                <tr>
                  <Th>Measure</Th>
                  <Th className="text-right">Saving / year ({t.energyUnit})</Th>
                  <Th className="text-right">Capital cost</Th>
                  <Th className="text-right">Payback</Th>
                </tr>
              </thead>
              <tbody>
                {latest.result.perMeasure.map((m) => (
                  <tr key={m.id}>
                    <Td className="font-medium text-mist-900">{m.description}</Td>
                    <Td className="text-right tabular">{formatIn(m.annualEnergySaving)}</Td>
                    <Td className="text-right tabular">{formatINR(m.capitalCostINR)}</Td>
                    <Td className="text-right tabular">
                      {m.simplePaybackYears === null ? (
                        <span className="text-xs text-mist-500" title={m.paybackNote ?? undefined}>
                          Not computed
                        </span>
                      ) : (
                        `${one(m.simplePaybackYears)} yr`
                      )}
                    </Td>
                  </tr>
                ))}
                <tr className="font-medium">
                  <Td>All measures</Td>
                  <Td className="text-right tabular">{formatIn(t.annualEnergySaving)}</Td>
                  <Td className="text-right tabular">{formatINR(t.capitalCostINR)}</Td>
                  <Td className="text-right tabular">
                    {t.simplePaybackYears === null ? "Not computed" : `${one(t.simplePaybackYears)} yr`}
                  </Td>
                </tr>
              </tbody>
            </Table>
            {t.measuresMissingCostSaving > 0 ? (
              <Alert tone="info">
                {t.measuresMissingCostSaving} measure(s) have no rupee saving recorded, so the portfolio payback is not
                computed.
              </Alert>
            ) : null}
            <ul className="space-y-1 text-xs text-mist-500">
              {latest.result.notComputed.map((n) => (
                <li key={n}>· {n}</li>
              ))}
            </ul>
          </>
        )}
      </CardBody>
    </Card>
  );
}
