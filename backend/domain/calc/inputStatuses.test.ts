import { describe, expect, it } from "vitest";
import { assessRunReadiness, inputStatuses, type ProvenancedFact } from "./run";
import { loadPack } from "../packs";
import { ADEETIE_FOUNDRY_V1 } from "../packs/adeetie";

function fact(id: string, path: string, value: number): ProvenancedFact {
  return {
    id,
    field_path: path,
    value_json: value,
    unit: null,
    document_id: "doc-1",
    page: 1,
    bbox: { x: 0.1, y: 0.1, width: 0.2, height: 0.05 },
    source_text: String(value),
  };
}

describe("inputStatuses", () => {
  const cement = loadPack("CCTS-CEMENT-v1");
  const productionPath = cement.production_binding!.path;

  it("calls production required until it has a fact", () => {
    expect(inputStatuses(cement, [], { draftMode: true })[productionPath]).toBe("required");
  });

  it("calls an input with one fact filled and with two facts a conflict", () => {
    expect(inputStatuses(cement, [fact("a", productionPath, 100)], { draftMode: true })[productionPath]).toBe("filled");
    expect(
      inputStatuses(cement, [fact("a", productionPath, 100), fact("b", productionPath, 120)], { draftMode: true })[productionPath]
    ).toBe("conflict");
  });

  it("calls a stream the pack requires required, and one it does not optional", () => {
    const states = inputStatuses(cement, [], { draftMode: true, complianceYear: "FY2025-26" });
    const required = cement.stream_bindings.find((b) => b.required && !b.requiredGroup);
    if (required) expect(states[required.quantity.path]).toBe("required");
    const optional = cement.stream_bindings.find((b) => !b.required && !b.requiredGroup);
    if (optional) expect(states[optional.quantity.path]).toBe("optional");
  });

  it("agrees with the run: a path the run needs is never called optional while it blocks the run", () => {
    const ready = assessRunReadiness(cement, [], { draftMode: true, complianceYear: "FY2025-26" });
    const states = inputStatuses(cement, [], { draftMode: true, complianceYear: "FY2025-26" });
    for (const b of cement.stream_bindings) {
      const blocked = ready.blockers.some((m) => m.includes(`"${b.quantity.path}"`));
      if (blocked && !b.requiredGroup) expect(states[b.quantity.path], b.quantity.path).not.toBe("optional");
    }
  });

  it("calls the members of an unsatisfied group of alternatives group, and optional once one is filled", () => {
    const member = cement.stream_bindings.find((b) => b.requiredGroup);
    if (!member) return;
    const members = cement.stream_bindings.filter((b) => b.requiredGroup === member.requiredGroup);
    const empty = inputStatuses(cement, [], { draftMode: true });
    for (const m of members) expect(["group", "optional"]).toContain(empty[m.quantity.path]);
    const one = inputStatuses(cement, [fact("a", members[0]!.quantity.path, 5)], { draftMode: true });
    expect(one[members[0]!.quantity.path]).toBe("filled");
    for (const m of members.slice(1)) expect(one[m.quantity.path]).not.toBe("group");
  });

  it("says a quantity with no calorific value needs one", () => {
    const fuel = cement.stream_bindings.find((b) => b.kind === "fuel_combustion");
    if (!fuel || fuel.kind !== "fuel_combustion") return;
    const states = inputStatuses(cement, [fact("a", fuel.quantity.path, 10)], { draftMode: true });
    expect(states[fuel.quantity.path]).toBe("filled");
    expect(states[fuel.calorificValue.path]).toBe("required");
  });
});

describe("energy-based (SEC) packs with two values on one input", () => {
  const pack = ADEETIE_FOUNDRY_V1;
  const path = pack.energy_bindings![0]!.quantity.path;
  const production = pack.production_binding!.path;

  it("warns that a run uses the first, and does not block", () => {
    const facts = [fact("a", path, 10), fact("b", path, 12), fact("p", production, 100)];
    const ready = assessRunReadiness(pack, facts, { draftMode: true });
    expect(ready.warnings.join(" ")).toMatch(/has 2 accepted values \(10, 12\)\. A run uses the first one/);
    expect(ready.blockers.join(" ")).not.toMatch(/accepted values/);
    expect(inputStatuses(pack, facts, { draftMode: true })[path]).toBe("conflict");
  });

  it("stays quiet with one value", () => {
    const ready = assessRunReadiness(pack, [fact("a", path, 10), fact("p", production, 100)], { draftMode: true });
    expect(ready.warnings.join(" ")).not.toMatch(/accepted values/);
  });
});
