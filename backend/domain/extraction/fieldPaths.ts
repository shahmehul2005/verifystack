/**
 * Process 3.4 — qualify flattened field paths so Process 5.0 can bind them.
 *
 * Extraction schemas are document-shaped (`quantity`, `activeEnergy`). Packs with
 * several fuels declare prefixed paths (`coke.quantity`). This rewrite is driven
 * by the extracted `fuelKind` (and by electricity field names), never by sector.
 */

export interface FlatField {
  fieldPath: string;
  value: unknown;
}

const FUEL_PATH_PREFIX: Record<string, string> = {
  coal: "coal",
  coke: "coke",
  png: "png",
  lpg: "lpg",
  furnace_oil: "furnaceOil",
  diesel: "diesel",
  biomass: "biomass",
  natural_gas: "naturalGas",
  petcoke: "petcoke",
  lignite: "lignite",
  naphtha: "naphtha",
  refinery_gas: "refineryGas",
  black_liquor: "blackLiquor",
  other: "other",
};

const FUEL_LEAVES = new Set(["quantity", "calorificValue", "calorificBasis"]);

const ELECTRICITY_LEAVES = new Set([
  "activeEnergy",
  "renewableEnergy",
  "contractedDemand",
  "maximumDemand",
  "unitCostINRPerKWh",
]);

/** Path heads used by pack fuel prefixes. Unqualified bindings must not steal these. */
export const FUEL_PATH_HEADS = new Set(Object.values(FUEL_PATH_PREFIX));

function leaf(path: string): string {
  return path.split(".").pop() ?? path;
}

function alreadyPrefixed(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}.`);
}

function fuelKindValue(fields: readonly FlatField[]): string | null {
  const hit = fields.find(
    (f) => f.fieldPath === "fuelKind" || f.fieldPath.endsWith(".fuelKind")
  );
  return typeof hit?.value === "string" ? hit.value : null;
}

export function matchFactPath(fieldPath: string, bindingPath: string): boolean {
  if (fieldPath === bindingPath) return true;
  if (fieldPath.endsWith(`.${bindingPath}`)) {
    if (bindingPath.includes(".")) return true;
    const parent = fieldPath.slice(0, -(bindingPath.length + 1));
    const head = parent.split(".")[0] ?? "";
    return !FUEL_PATH_HEADS.has(head);
  }
  // Extracted HT bills historically stored `activeEnergy`; packs bind `electricity.activeEnergy`.
  if (
    bindingPath.startsWith("electricity.") &&
    fieldPath === bindingPath.slice("electricity.".length)
  ) {
    return true;
  }
  return false;
}

/**
 * Rewrite flattened extract paths:
 *  - fuelKind=coke → quantity becomes coke.quantity
 *  - electricity bill leaves → electricity.activeEnergy, etc.
 *
 * Idempotent. Unknown fuelKind leaves paths unchanged (no silent remap).
 */
export function qualifyExtractedFieldPaths<T extends FlatField>(fields: T[]): T[] {
  const kind = fuelKindValue(fields);
  const fuelPrefix = kind ? (FUEL_PATH_PREFIX[kind] ?? null) : null;

  return fields.map((f) => {
    const key = leaf(f.fieldPath);
    if (fuelPrefix && FUEL_LEAVES.has(key) && !alreadyPrefixed(f.fieldPath, fuelPrefix)) {
      return { ...f, fieldPath: `${fuelPrefix}.${key}` };
    }
    if (
      !fuelPrefix &&
      ELECTRICITY_LEAVES.has(key) &&
      !alreadyPrefixed(f.fieldPath, "electricity")
    ) {
      return { ...f, fieldPath: `electricity.${key}` };
    }
    return f;
  });
}
