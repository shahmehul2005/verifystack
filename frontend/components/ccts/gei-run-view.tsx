import Link from "next/link";
import { Flame, Zap, ShieldCheck, FileSpreadsheet, FileText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { Card, CardBody, CardHeader, SectionTitle } from "@/components/ui/card";
import { StatTile } from "@/components/ui/stat";
import { formatIn } from "@/lib/format";
import type { CalcResult } from "@verifystack/backend/domain/calc/engine";
import type { ProvenancedFact } from "@verifystack/backend/domain/calc/run";

export function GeiRunView({
  result,
  facts = [],
  engagementId,
}: {
  result: CalcResult;
  facts?: ProvenancedFact[];
  engagementId: string;
}) {
  const scope1Tonne = result.scope1.value / 1000;
  const scope2Tonne = result.scope2.value / 1000;
  const totalTonne = result.totalEmissions.value / 1000;
  const prodTonne = result.production.value;
  const gei = result.gei;
  const target = result.geiTarget;
  const headroom = result.geiHeadroom;
  const ccc = result.creditPositionTCO2e;

  const factsById = new Map(facts.map((f) => [f.id, f]));

  return (
    <div className="space-y-8">
      {/* 1. Top Executive Metrics */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Specific GHG intensity (GEI)"
          value={<span className="font-mono text-2xl font-bold text-ink">{gei.toFixed(6)}</span>}
          hint="tCO₂e per tonne product"
        />
        <StatTile
          label="Total GHG emissions"
          value={<span className="font-mono text-xl">{formatIn(totalTonne, { maximumFractionDigits: 1 })}</span>}
          hint="tCO₂e (Scope 1 + Scope 2)"
        />
        <StatTile
          label="Total equivalent product"
          value={<span className="font-mono text-xl">{formatIn(prodTonne, { maximumFractionDigits: 0 })}</span>}
          hint={result.production.unit ?? "t"}
        />
        {target !== undefined ? (
          <StatTile
            label={`CCC Position (Target: ${target.toFixed(4)})`}
            value={
              <span
                className={`font-mono text-xl font-bold ${
                  (ccc ?? 0) >= 0 ? "text-emerald-700" : "text-rose-700"
                }`}
              >
                {(ccc ?? 0) >= 0 ? `+${formatIn(ccc ?? 0, { maximumFractionDigits: 0 })}` : formatIn(ccc ?? 0, { maximumFractionDigits: 0 })}
              </span>
            }
            hint={
              (ccc ?? 0) >= 0
                ? "Surplus CCCs to receive (Section 14AA)"
                : "Deficit CCCs to purchase"
            }
          />
        ) : (
          <StatTile
            label="Scope 1 / Scope 2 Split"
            value={
              <span className="text-sm font-medium">
                {((scope1Tonne / (totalTonne || 1)) * 100).toFixed(1)}% S1 / {((scope2Tonne / (totalTonne || 1)) * 100).toFixed(1)}% S2
              </span>
            }
            hint="Gross emissions share"
          />
        )}
      </div>

      {/* 2. Statutory Equations & Proof Breakdown */}
      <Card>
        <CardHeader
          title="BEE CCTS Statutory Equation Trace"
          description="Every calculation step mapped directly to the gazetted equations in Detailed Procedure Annexure II and Section 7."
          actions={
            <Badge tone="ok" dot>
              Deterministic Verification Proof
            </Badge>
          }
        />
        <CardBody className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            {/* Equation I */}
            <div className="rounded-lg border border-mist-200 bg-mist-50/50 p-4">
              <div className="flex items-center justify-between pb-2 border-b border-mist-200">
                <span className="font-semibold text-sm text-ink">Equation I: Total GHG Emissions</span>
                <span className="text-xs text-mist-500 font-mono">Annexure II.A</span>
              </div>
              <p className="mt-2 font-mono text-xs text-mist-700">
                Total GHG = Scope 1 (Direct) + Scope 2 (Indirect) − Export Deductions
              </p>
              <div className="mt-3 rounded bg-white p-2.5 font-mono text-xs border border-mist-200 text-mist-900">
                <span className="font-bold text-ink">{formatIn(totalTonne, { maximumFractionDigits: 2 })} tCO₂e</span> ={" "}
                <span className="text-amber-800">{formatIn(scope1Tonne, { maximumFractionDigits: 2 })} (S1)</span> +{" "}
                <span className="text-sky-800">{formatIn(scope2Tonne, { maximumFractionDigits: 2 })} (S2)</span> − 0 (Export)
              </div>
            </div>

            {/* Equation II */}
            <div className="rounded-lg border border-mist-200 bg-mist-50/50 p-4">
              <div className="flex items-center justify-between pb-2 border-b border-mist-200">
                <span className="font-semibold text-sm text-ink">Equation II: Specific GHG Intensity</span>
                <span className="text-xs text-mist-500 font-mono">Annexure II.B</span>
              </div>
              <p className="mt-2 font-mono text-xs text-mist-700">
                GEI (tCO₂e/t) = Total GHG Emissions (tCO₂e) ÷ Total Equivalent Output (t)
              </p>
              <div className="mt-3 rounded bg-white p-2.5 font-mono text-xs border border-mist-200 text-mist-900">
                <span className="font-bold text-ink">{gei.toFixed(6)} tCO₂e/t</span> ={" "}
                {formatIn(totalTonne, { maximumFractionDigits: 2 })} tCO₂e ÷ {formatIn(prodTonne, { maximumFractionDigits: 0 })} t
              </div>
            </div>
          </div>

          {/* Target comparison if present */}
          {target !== undefined && (
            <div className="rounded-lg border border-mist-200 bg-mist-50/50 p-4">
              <div className="flex items-center justify-between pb-2 border-b border-mist-200">
                <span className="font-semibold text-sm text-ink">Clause 7(1): Carbon Credit Certificates (CCC) Entitlement</span>
                <span className="text-xs text-mist-500 font-mono">Section 7(1)(b)</span>
              </div>
              <p className="mt-2 font-mono text-xs text-mist-700">
                CCCs = (Target GEI − Achieved GEI) × Production in Compliance Cycle
              </p>
              <div className="mt-3 rounded bg-white p-2.5 font-mono text-xs border border-mist-200 text-mist-900 flex flex-wrap items-center gap-2">
                <span className={`font-bold ${ (ccc ?? 0) >= 0 ? "text-emerald-700" : "text-rose-700" }`}>
                  {(ccc ?? 0) >= 0 ? `+${formatIn(ccc ?? 0, { maximumFractionDigits: 0 })} CCCs (Entitlement)` : `${formatIn(ccc ?? 0, { maximumFractionDigits: 0 })} CCCs (Liability)`}
                </span>
                <span>= ({target.toFixed(6)} − {gei.toFixed(6)}) × {formatIn(prodTonne, { maximumFractionDigits: 0 })}</span>
                <span className="text-mist-500">
                  {headroom !== undefined && headroom >= 0
                    ? `[Over-performing by ${headroom.toFixed(6)} tCO₂e/t]`
                    : `[Under-performing by ${Math.abs(headroom ?? 0).toFixed(6)} tCO₂e/t]`}
                </span>
              </div>
            </div>
          )}
        </CardBody>
      </Card>

      {/* 3. Stream-by-Stream Calculation Breakdown */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <SectionTitle>Emissions Breakdown by Stream (Auditor Defense Ledger)</SectionTitle>
          <span className="text-xs text-mist-600">
            {result.streams.length} {result.streams.length === 1 ? "stream" : "streams"} bound
          </span>
        </div>

        <div className="space-y-4">
          {result.streams.map((stream) => {
            const streamTonne = stream.emissions.value / 1000;
            const pctShare = totalTonne > 0 ? (streamTonne / totalTonne) * 100 : 0;
            const isScope1 = stream.scope === 1;

            return (
              <Card key={stream.streamId} className="overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-mist-200 bg-mist-50/70 px-4 py-3">
                  <div className="flex items-center gap-2.5">
                    {isScope1 ? (
                      <Flame className="h-4 w-4 text-amber-600" />
                    ) : (
                      <Zap className="h-4 w-4 text-sky-600" />
                    )}
                    <span className="font-semibold text-sm text-ink">{stream.label}</span>
                    <span className="font-mono text-xs text-mist-500">({stream.streamId})</span>
                    <Badge tone={isScope1 ? "draft" : "ink"}>
                      Scope {stream.scope}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="font-mono text-sm font-bold text-ink">
                      {formatIn(streamTonne, { maximumFractionDigits: 2 })} tCO₂e
                    </span>
                    <Badge tone="ink">{pctShare.toFixed(1)}%</Badge>
                  </div>
                </div>

                <CardBody className="space-y-4 text-xs">
                  {/* Derivation Step */}
                  <div>
                    <span className="font-medium text-mist-700">Deterministic Mathematical Derivation:</span>
                    <div className="mt-1.5 rounded-md bg-mist-900 p-2.5 font-mono text-emerald-300 overflow-x-auto whitespace-pre-wrap leading-relaxed">
                      {stream.derivation}
                    </div>
                  </div>

                  {/* Factor Details */}
                  {stream.factorsUsed.length > 0 && (
                    <div>
                      <span className="font-medium text-mist-700">Calculation Factors Applied:</span>
                      <div className="mt-1.5 overflow-x-auto">
                        <table className="w-full border-collapse border border-mist-200 text-left text-xs">
                          <thead className="bg-mist-100/70 text-mist-700">
                            <tr>
                              <th className="p-2 border border-mist-200">Factor Key</th>
                              <th className="p-2 border border-mist-200">Vintage</th>
                              <th className="p-2 border border-mist-200">Value</th>
                              <th className="p-2 border border-mist-200">Unit</th>
                              <th className="p-2 border border-mist-200">Statutory Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {stream.factorsUsed.map((f) => (
                              <tr key={`${f.id}-${f.vintage}`} className="bg-white">
                                <td className="p-2 border border-mist-200 font-mono font-medium">{f.id}</td>
                                <td className="p-2 border border-mist-200 font-mono">{f.vintage}</td>
                                <td className="p-2 border border-mist-200 font-mono font-bold">{f.value}</td>
                                <td className="p-2 border border-mist-200">{f.unit}</td>
                                <td className="p-2 border border-mist-200">
                                  <Badge tone={f.verified ? "ok" : "draft"} dot>
                                    {f.verified ? "Verified Official" : "Type I Default / Pending"}
                                  </Badge>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Provenance Backing */}
                  <div>
                    <span className="font-medium text-mist-700">Evidence Provenance:</span>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      {stream.provenance.label && (
                        <span className="rounded bg-mist-100 px-2 py-1 text-mist-800 font-medium">
                          {stream.provenance.label}
                        </span>
                      )}
                      {stream.provenance.factIds.map((factId) => {
                        const fact = factsById.get(factId);
                        return (
                          <Link
                            key={factId}
                            href={`/engagements/${engagementId}/facts`}
                            className="inline-flex items-center gap-1 rounded border border-mist-300 bg-white px-2 py-0.5 font-mono text-mist-700 hover:border-emerald-500 hover:text-emerald-700"
                            title={fact ? `Path: ${fact.field_path} = ${JSON.stringify(fact.value_json)} ${fact.unit ?? ""}` : factId}
                          >
                            <ShieldCheck className="h-3 w-3 text-emerald-600" />
                            {factId}
                            {fact?.provenance_type === "spreadsheet_cell" && (
                              <FileSpreadsheet className="h-3 w-3 text-mist-400" />
                            )}
                            {fact?.provenance_type === "document_page" && (
                              <FileText className="h-3 w-3 text-mist-400" />
                            )}
                          </Link>
                        );
                      })}
                    </div>
                  </div>

                  {/* Warnings on this stream */}
                  {stream.warnings.length > 0 && (
                    <Alert tone="warn" title="Stream Notices">
                      <ul className="list-disc pl-4 space-y-0.5">
                        {stream.warnings.map((w, idx) => (
                          <li key={idx}>{w}</li>
                        ))}
                      </ul>
                    </Alert>
                  )}
                </CardBody>
              </Card>
            );
          })}
        </div>
      </section>

      {/* 4. Global Run Warnings if any */}
      {result.warnings.length > 0 && (
        <Alert tone="warn" title="General Calculation Warnings">
          <ul className="list-disc pl-4 space-y-1 text-xs">
            {result.warnings.map((w, idx) => (
              <li key={idx}>{w}</li>
            ))}
          </ul>
        </Alert>
      )}
    </div>
  );
}
