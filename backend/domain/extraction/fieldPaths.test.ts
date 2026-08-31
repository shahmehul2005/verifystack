import { describe, expect, it } from "vitest";
import { qualifyExtractedFieldPaths, matchFactPath } from "./fieldPaths";

describe("qualifyExtractedFieldPaths", () => {
  it("prefixes fuel quantity and CV from fuelKind, leaving fuelKind itself", () => {
    const out = qualifyExtractedFieldPaths([
      { fieldPath: "fuelKind", value: "coke" },
      { fieldPath: "quantity", value: 400 },
      { fieldPath: "calorificValue", value: 6500 },
      { fieldPath: "supplierName", value: "X" },
    ]);
    expect(out.map((f) => f.fieldPath)).toEqual([
      "fuelKind",
      "coke.quantity",
      "coke.calorificValue",
      "supplierName",
    ]);
  });

  it("maps furnace_oil to furnaceOil and does not double-prefix", () => {
    const once = qualifyExtractedFieldPaths([
      { fieldPath: "fuelKind", value: "furnace_oil" },
      { fieldPath: "quantity", value: 1 },
    ]);
    expect(once[1]?.fieldPath).toBe("furnaceOil.quantity");
    const twice = qualifyExtractedFieldPaths(once);
    expect(twice[1]?.fieldPath).toBe("furnaceOil.quantity");
  });

  it("prefixes electricity bill leaves without a fuelKind", () => {
    const out = qualifyExtractedFieldPaths([
      { fieldPath: "activeEnergy", value: 100 },
      { fieldPath: "contractedDemand", value: 2500 },
      { fieldPath: "utilityName", value: "DISCOM" },
    ]);
    expect(out.map((f) => f.fieldPath)).toEqual([
      "electricity.activeEnergy",
      "electricity.contractedDemand",
      "utilityName",
    ]);
  });

  it("leaves an unprefixed cement-style fuel invoice unchanged when fuelKind is absent", () => {
    const out = qualifyExtractedFieldPaths([
      { fieldPath: "quantity", value: 18247 },
      { fieldPath: "calorificValue", value: 4200 },
    ]);
    expect(out.map((f) => f.fieldPath)).toEqual(["quantity", "calorificValue"]);
  });

  it("does not remap an unknown fuelKind", () => {
    const out = qualifyExtractedFieldPaths([
      { fieldPath: "fuelKind", value: "not-a-fuel" },
      { fieldPath: "quantity", value: 1 },
    ]);
    expect(out[1]?.fieldPath).toBe("quantity");
  });
});

describe("matchFactPath", () => {
  it("does not let a prefixed fuel quantity satisfy an unqualified cement-style binding", () => {
    expect(matchFactPath("petcoke.quantity", "quantity")).toBe(false);
    expect(matchFactPath("quantity", "quantity")).toBe(true);
    expect(matchFactPath("electricity.activeEnergy", "activeEnergy")).toBe(true);
    expect(matchFactPath("electricity.activeEnergy", "electricity.activeEnergy")).toBe(true);
    expect(matchFactPath("lines.0.quantity", "quantity")).toBe(true);
    expect(matchFactPath("activeEnergy", "electricity.activeEnergy")).toBe(true);
    expect(matchFactPath("quantity", "coke.quantity")).toBe(false);
  });
});
