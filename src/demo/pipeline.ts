import { buildFactorSet } from "@/domain/factors";
import { calculate } from "@/domain/calc/engine";
import { runRules } from "@/domain/rules/rules";
import { draftCarFromTemplate } from "@/domain/ai/draftCar";
import {
  SEED_AI_ACTIONS,
  SEED_DOCUMENTS,
  SEED_ENGAGEMENT,
  SEED_FACTS,
  seedCalcInput,
  seedReconciliationContext,
} from "./seed";
import type { DemoPayload, TraceableNumber } from "./types";

export function runDemoPipeline(): DemoPayload {
  const factors = buildFactorSet("demo-factorset-0.1.0");
  const calc = calculate(seedCalcInput(), factors);
  const rules = runRules(seedReconciliationContext(calc));
  const cars = rules.findings.map(draftCarFromTemplate);

  const streamTrace: TraceableNumber[] = calc.streams.map((s) => ({
    id: `stream-${s.streamId}`,
    label: s.label,
    value: `${(s.emissions.value / 1000).toLocaleString("en-IN", {
      maximumFractionDigits: 1,
    })} tCO₂e`,
    factIds: s.provenance.factIds,
    derivation: s.derivation,
    scope: s.scope,
  }));

  const totals: TraceableNumber[] = [
    {
      id: "gei",
      label: "GEI achieved",
      value: `${calc.gei.toFixed(4)} tCO₂e / t cement`,
      factIds: calc.streams.flatMap((s) => s.provenance.factIds).concat(["fact-prod"]),
      derivation: `Total ${calc.totalEmissions.value / 1000} tCO₂e ÷ ${calc.production.value.toLocaleString("en-IN")} t`,
    },
    {
      id: "scope1",
      label: "Scope 1",
      value: `${(calc.scope1.value / 1000).toLocaleString("en-IN", {
        maximumFractionDigits: 1,
      })} tCO₂e`,
      factIds: calc.streams
        .filter((s) => s.scope === 1)
        .flatMap((s) => s.provenance.factIds),
    },
    {
      id: "scope2",
      label: "Scope 2",
      value: `${(calc.scope2.value / 1000).toLocaleString("en-IN", {
        maximumFractionDigits: 1,
      })} tCO₂e`,
      factIds: calc.streams
        .filter((s) => s.scope === 2)
        .flatMap((s) => s.provenance.factIds),
    },
  ];

  if (typeof calc.creditPositionTCO2e === "number") {
    totals.push({
      id: "ccc",
      label: "Indicative CCC position",
      value: `${calc.creditPositionTCO2e.toLocaleString("en-IN", {
        maximumFractionDigits: 0,
      })} tCO₂e ${calc.creditPositionTCO2e >= 0 ? "surplus" : "deficit"}`,
      factIds: ["fact-prod"],
      derivation: "Draft-mode factors — not for filing",
    });
  }

  return {
    engagement: { ...SEED_ENGAGEMENT, draftMode: true },
    documents: SEED_DOCUMENTS,
    facts: SEED_FACTS,
    calc,
    rules,
    cars,
    traceables: [...totals, ...streamTrace],
    aiActions: SEED_AI_ACTIONS,
    disclaimer:
      "Synthetic plant. Emission factors are unverified placeholders. AI proposes; the licensed verifier decides. Not a verification opinion.",
  };
}
