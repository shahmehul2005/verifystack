import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildFactorSet } from "../factors";
import { calculate } from "./engine";
import { mapFactsToCalcInput, type ProvenancedFact } from "./run";
import { mapFactsToSecInput } from "./secRun";
import { calculateSec } from "./sec";
import { loadPack, PACK_REGISTRY } from "../packs";
import type { MethodologyPack } from "../packs/types";

const factors = buildFactorSet("test-0.1.0");

function fact(
  id: string,
  field_path: string,
  value: unknown,
  unit: string | null = null
): ProvenancedFact {
  return {
    id,
    field_path,
    value_json: value,
    unit,
    document_id: `doc-${id}`,
    page: 1,
    bbox: { x: 0.1, y: 0.1, width: 0.2, height: 0.05 },
    source_text: `source for ${field_path}`,
  };
}

/**
 * A pack for a sector that does not exist, with stream ids, fact paths, factors and
 * a denominator that appear nowhere in the codebase.
 *
 * If the mapper still produces a correct CalcInput from it, the mapper cannot be
 * carrying sector knowledge — which is the architectural claim Processes 3.0 and
 * 5.0 are supposed to satisfy.
 */
const INVENTED_PACK: MethodologyPack = {
  pack_id: "TEST-INVENTED-SECTOR-v1",
  scheme: "CCTS",
  sector_or_cluster: "Invented Widgets",
  status: "runnable",
  version: "1.0.0",
  document_taxonomy: [],
  field_schemas: {},
  calculation_method: "GEI",
  emission_or_energy_factors: [],
  stream_bindings: [
    {
      kind: "fuel_combustion",
      streamId: "zorb-burner",
      label: "Zorb burner lignite",
      quantity: { path: "zorb.mass", units: ["kg", "t"], defaultUnit: "t" },
      calorificValue: {
        path: "zorb.cv",
        units: ["kcal/kg", "MJ/kg"],
        defaultUnit: "MJ/kg",
      },
      factorKey: "ef_lignite",
      factorVintage: "IPCC2006",
      phase: "solid",
      oxidationFactor: 0.98,
    },
    {
      kind: "electricity_import",
      streamId: "quux-supply",
      label: "Quux substation supply",
      quantity: { path: "quux.units", units: ["kWh", "MWh"], defaultUnit: "kWh" },
      factorKey: "cea_grid_ef",
      factorVintage: "FY2025-26",
    },
    {
      kind: "process_direct",
      streamId: "widget-calcination",
      label: "Widget calcination",
      quantity: {
        path: "widget.processEmissions",
        units: ["tCO2e", "kgCO2e"],
        defaultUnit: "tCO2e",
      },
      methodologyRef: "Invented methodology reference",
    },
  ],
  production_binding: {
    path: "widget.output",
    units: ["t", "kt"],
    defaultUnit: "t",
    productUnitLabel: "tonne_widgets",
    productLabel: "Widgets",
  },
  reconciliation_rules: [],
  clause_citations: [],
  report_template: "ccts-gei-form-ab-v1",
};

describe("the GEI mapper is driven by the pack, not by the sector", () => {
  const facts = [
    fact("f1", "zorb.mass", 100, "t"),
    fact("f2", "zorb.cv", 15, "MJ/kg"),
    fact("f3", "quux.units", 50_000, "kWh"),
    fact("f4", "widget.processEmissions", 42, "tCO2e"),
    fact("f5", "widget.output", 500, "t"),
  ];

  const input = mapFactsToCalcInput(INVENTED_PACK, {
    engagementId: "eng-invented",
    complianceYear: "FY2025-26",
    draftMode: true,
    facts,
  });

  it("builds every declared stream kind for a sector the code has never heard of", () => {
    expect(input.streams.map((s) => s.streamId)).toEqual([
      "zorb-burner",
      "quux-supply",
      "widget-calcination",
    ]);
    expect(input.streams.map((s) => s.kind)).toEqual([
      "fuel_combustion",
      "electricity_import",
      "process_direct",
    ]);
    expect(input.production.productUnitLabel).toBe("tonne_widgets");
    expect(input.production.quantity).toEqual({ value: 500, unit: "t" });
  });

  it("carries the pack's factors and oxidation factor onto the stream", () => {
    const fuel = input.streams[0];
    expect(fuel).toMatchObject({
      kind: "fuel_combustion",
      emissionFactorId: "ef_lignite",
      emissionFactorVintage: "IPCC2006",
      oxidationFactor: 0.98,
      phase: "solid",
    });
  });

  it("traces every stream back to the fact it came from", () => {
    for (const s of input.streams) {
      expect(s.provenance.factIds.length).toBeGreaterThan(0);
      expect(s.provenance.label).toMatch(/^source for /);
    }
  });

  it("computes through the unmodified engine", () => {
    const result = calculate(input, factors);
    expect(result.streams).toHaveLength(3);
    expect(result.gei).toBeGreaterThan(0);
    // The process stream is scope 1 and passes through untouched.
    const process = result.streams.find((s) => s.streamId === "widget-calcination");
    expect(process?.emissions).toEqual({ value: 42_000, unit: "kgCO2e" });
  });
});

describe("binding resolution rules", () => {
  it("honours the unit as printed when the binding allows it", () => {
    const input = mapFactsToCalcInput(INVENTED_PACK, {
      engagementId: "e",
      complianceYear: "FY2025-26",
      draftMode: true,
      facts: [
        fact("f1", "zorb.mass", 100_000, "kg"),
        fact("f2", "zorb.cv", 3_600, "kcal/kg"),
        fact("f5", "widget.output", 500, "t"),
      ],
    });
    expect(input.streams[0]).toMatchObject({
      quantity: { value: 100_000, unit: "kg" },
      calorificValue: { value: 3_600, unit: "kcal/kg" },
    });
  });

  it("falls back to the declared default rather than accepting a foreign unit", () => {
    const input = mapFactsToCalcInput(INVENTED_PACK, {
      engagementId: "e",
      complianceYear: "FY2025-26",
      draftMode: true,
      facts: [
        // "bags" is not in the binding's unit list.
        fact("f1", "zorb.mass", 100, "bags"),
        fact("f2", "zorb.cv", 15, "MJ/kg"),
        fact("f5", "widget.output", 500, "t"),
      ],
    });
    expect(input.streams[0]).toMatchObject({ quantity: { value: 100, unit: "t" } });
  });

  it("omits an optional stream whose fact is absent", () => {
    const input = mapFactsToCalcInput(INVENTED_PACK, {
      engagementId: "e",
      complianceYear: "FY2025-26",
      draftMode: true,
      facts: [fact("f3", "quux.units", 1_000, "kWh"), fact("f5", "widget.output", 5, "t")],
    });
    expect(input.streams.map((s) => s.streamId)).toEqual(["quux-supply"]);
  });

  it("refuses when a required stream's fact is absent", () => {
    const required: MethodologyPack = {
      ...INVENTED_PACK,
      stream_bindings: [
        { ...INVENTED_PACK.stream_bindings[1]!, required: true },
      ],
    };
    expect(() =>
      mapFactsToCalcInput(required, {
        engagementId: "e",
        complianceYear: "FY2025-26",
        draftMode: true,
        facts: [fact("f5", "widget.output", 5, "t")],
      })
    ).toThrow(/requires a fact at "quux.units"/);
  });

  it("refuses a pack that declares no bindings or no denominator", () => {
    expect(() =>
      mapFactsToCalcInput(
        { ...INVENTED_PACK, stream_bindings: [] },
        { engagementId: "e", complianceYear: "y", draftMode: true, facts: [] }
      )
    ).toThrow(/no stream bindings/);

    expect(() =>
      mapFactsToCalcInput(
        { ...INVENTED_PACK, production_binding: undefined },
        { engagementId: "e", complianceYear: "y", draftMode: true, facts: [] }
      )
    ).toThrow(/no production binding/);
  });

  it("routes an SEC pack away from the GEI mapper", () => {
    expect(() =>
      mapFactsToCalcInput(loadPack("ADEETIE-FOUNDRY-v1"), {
        engagementId: "e",
        complianceYear: "y",
        draftMode: true,
        facts: [],
      })
    ).toThrow(/SEC packs run through/);
  });
});

describe("the SEC mapper is likewise driven by the pack", () => {
  const facts = [
    fact("f-elec", "electricity.activeEnergy", 1_200_000, "kWh"),
    fact("f-cd", "electricity.contractedDemand", 2_500, "kVA"),
    fact("f-md", "electricity.maximumDemand", 2_100, "kVA"),
    fact("f-coke", "coke.quantity", 400, "t"),
    fact("f-coke-cv", "coke.calorificValue", 6_500, "kcal/kg"),
    fact("f-png", "png.quantity", 50_000, "SCM"),
    fact("f-diesel", "diesel.quantity", 4_000, "L"),
    fact("f-prod", "production", 2_000, "t"),
  ];

  const input = mapFactsToSecInput(loadPack("ADEETIE-FOUNDRY-v1"), {
    engagementId: "eng-foundry",
    periodLabel: "FY2024-25",
    phase: "baseline",
    draftMode: true,
    facts,
  });

  it("builds only the streams whose facts are present", () => {
    expect(input.streams.map((s) => s.streamId)).toEqual([
      "grid-electricity",
      "coke",
      "png",
      "diesel",
    ]);
  });

  it("prefers a measured calorific value and falls back to the registry otherwise", () => {
    const coke = input.streams.find((s) => s.streamId === "coke");
    expect(coke).toMatchObject({ energyContent: { value: 6_500, unit: "kcal/kg" } });
    expect(coke && "energyFactorId" in coke).toBe(false);

    // No png.calorificValue fact was supplied, so the registry default applies.
    const png = input.streams.find((s) => s.streamId === "png");
    expect(png).toMatchObject({
      energyFactorId: "ec_png",
      energyFactorVintage: "TO-VERIFY",
    });
  });

  it("keeps kVA demand on its own axis, never in the streams", () => {
    expect(input.demand?.contractedDemand).toEqual({ value: 2_500, unit: "kVA" });
    expect(input.demand?.maximumDemand).toEqual({ value: 2_100, unit: "kVA" });
    for (const s of input.streams) {
      expect(s.quantity.unit).not.toBe("kVA");
    }
  });

  it("computes through the SEC engine and warns about every registry default used", () => {
    const r = calculateSec(input, factors);
    expect(r.sec).toBeGreaterThan(0);
    expect(r.secUnitLabel).toBe("GJ/t");
    expect(r.warnings.some((w) => w.includes("UNVERIFIED"))).toBe(true);
    expect(r.warnings.some((w) => w.includes("no measured calorific value"))).toBe(true);
  });

  it("refuses a GEI pack", () => {
    expect(() =>
      mapFactsToSecInput(loadPack("CCTS-CEMENT-v1"), {
        engagementId: "e",
        periodLabel: "y",
        phase: "baseline",
        draftMode: true,
        facts: [],
      })
    ).toThrow(/not handled by the SEC mapper/);
  });
});

describe("Process 5.0 contains no sector or scheme branch", () => {
  const files = ["run.ts", "engine.ts", "sec.ts", "secRun.ts"];

  it("names no sector, scheme, or cluster in the calculation path", () => {
    // The mappers and engines must be readable without knowing which sector is
    // being calculated. A literal sector name here would mean behaviour had leaked
    // out of the pack record and back into code.
    const forbidden = [
      "Cement",
      "Iron & Steel",
      "Aluminium",
      "Foundry",
      "Chlor-Alkali",
      "Fertilizer",
      "Petrochemicals",
      "Textiles",
      "coal-kiln",
      "grid-ht",
      "ef_coal_subbituminous",
      "cea_grid_ef",
      "ec_coke",
    ];

    for (const file of files) {
      const source = readFileSync(join(__dirname, file), "utf8");
      // Strip comments; prose may legitimately mention a sector to explain a rule.
      const code = source
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      for (const token of forbidden) {
        expect(
          code.includes(token),
          `${file} references "${token}" outside a comment`
        ).toBe(false);
      }
    }
  });

  it("keeps every runnable pack's behaviour in its record", () => {
    const runnable = PACK_REGISTRY.filter((p) => p.status === "runnable");
    expect(runnable.length).toBe(23);
    for (const p of runnable) {
      const bindings =
        p.calculation_method === "GEI" ? p.stream_bindings : p.energy_bindings ?? [];
      expect(bindings.length).toBeGreaterThan(0);
      expect(p.production_binding).toBeDefined();
    }
  });

  it("maps Chlor-Alkali from pack bindings with no sector branch", () => {
    const input = mapFactsToCalcInput(loadPack("CCTS-CHLOR-ALKALI-v1"), {
      engagementId: "e",
      complianceYear: "FY2025-26",
      draftMode: true,
      facts: [
        fact("f-elec", "electricity.activeEnergy", 1000, "MWh"),
        fact("f-prod", "production", 50_000, "t"),
      ],
    });
    expect(input.streams.map((s) => s.streamId)).toEqual(["grid-cells"]);
    expect(input.production.productUnitLabel).toBe("tonne_equivalent_caustic_soda");
    const r = calculate(input, factors);
    expect(r.gei).toBeGreaterThan(0);
  });
});
