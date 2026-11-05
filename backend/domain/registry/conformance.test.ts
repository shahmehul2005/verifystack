import { describe, expect, it } from "vitest";
import { CEMENT_DESK_REVIEW } from "../deskreview/cement";
import { CCTS_CEMENT_V1 } from "../packs/ccts/cement";
import { DOC_SCHEMAS, type ExtractableDocType } from "../extraction/schemas";
import { matchFactPath, qualifyExtractedFieldPaths } from "../extraction/fieldPaths";
import { CEMENT_REGISTRY, entryFor, membersOn, type RegistryEntry, type Surface } from "./index";

/**
 * The registry against the three places a quantity is really defined: the pack the calculation reads,
 * desk review's readings, and the extraction schemas. It fails when they drift from it, and when a new
 * name for one of its quantities appears without being classified.
 *
 * What it cannot see: a desk-review reading key produced by a workbook reader and used by no rule. Rules
 * are the only list of reader keys, so such a key is invisible here.
 */

// --- What each place actually defines ------------------------------------------------------------

interface Binding {
  quantity?: { path: string; units: readonly string[]; defaultUnit: string };
  calorificValue?: { path: string; units: readonly string[]; defaultUnit: string };
}
const bindings = (CCTS_CEMENT_V1.stream_bindings ?? []) as unknown as Binding[];

const packBindingPaths = new Map<string, { units: readonly string[]; defaultUnit: string }>();
for (const b of bindings) {
  if (b.quantity) packBindingPaths.set(b.quantity.path, b.quantity);
  if (b.calorificValue) packBindingPaths.set(b.calorificValue.path, b.calorificValue);
}
const production = CCTS_CEMENT_V1.production_binding as unknown as { path: string; units: readonly string[]; defaultUnit: string };
packBindingPaths.set(production.path, production);

const packProforma = new Map((CCTS_CEMENT_V1.proforma_inputs ?? []).filter((p) => p.fieldPath).map((p) => [p.fieldPath as string, p]));
const deskCells = new Map(CEMENT_DESK_REVIEW.proformaCells.map((c) => [c.fieldPath as string, c]));
const deskManual = new Map(CEMENT_DESK_REVIEW.manual.map((s) => [s.key, s]));
const ruleNeeds = new Set(CEMENT_DESK_REVIEW.rules.flatMap((r) => r.needs));

const extractionLeaves = new Set<string>();
for (const docType of Object.keys(CCTS_CEMENT_V1.field_schemas ?? {})) {
  const schema = DOC_SCHEMAS[docType as ExtractableDocType];
  if (!schema) continue;
  for (const leaf of Object.keys((schema as unknown as { shape: Record<string, unknown> }).shape)) extractionLeaves.add(`${docType}.${leaf}`);
}

function exists(surface: Surface, name: string): boolean {
  switch (surface) {
    case "pack_binding":
      return packBindingPaths.has(name);
    case "pack_proforma":
      return packProforma.has(name);
    case "proforma_cell":
      return deskCells.has(name);
    case "desk_manual":
      return deskManual.has(name);
    case "desk_reader":
      return ruleNeeds.has(name);
    case "extraction_field":
      return extractionLeaves.has(name);
  }
}

const entries = CEMENT_REGISTRY.entries;
const allMembers = entries.flatMap((e) => e.members.map((m) => ({ entry: e, ...m })));
const allExcluded = entries.flatMap((e) => e.excluded.map((x) => ({ entry: e, ...x })));

// --- Structure ----------------------------------------------------------------------------------

describe("registry structure", () => {
  it("has unique keys, and a name belongs to at most one entry", () => {
    expect(new Set(entries.map((e) => e.key)).size).toBe(entries.length);
    const seen = new Map<string, string>();
    for (const m of allMembers) {
      const id = `${m.surface}:${m.name}`;
      expect(seen.get(id), `${id} is a member of two entries`).toBeUndefined();
      seen.set(id, m.entry.key);
    }
  });

  it("never lists a name as both a member and an exclusion", () => {
    const members = new Set(allMembers.map((m) => `${m.surface}:${m.name}`));
    for (const x of allExcluded) expect(members.has(`${x.surface}:${x.name}`), `${x.name} is both`).toBe(false);
  });

  it("states a unit the entry allows, and a standard unit it allows", () => {
    for (const e of entries) {
      expect(e.validation.allowedUnits).toContain(e.standardUnit);
      for (const m of e.members) if (m.unit !== null) expect(e.validation.allowedUnits, `${e.key}: ${m.name} in ${m.unit}`).toContain(m.unit);
    }
  });

  it("sets no numeric range: that needs a cited source", () => {
    for (const e of entries) expect(Object.keys(e.validation).sort()).toEqual(["allowedUnits", "finite", "nonNegative"]);
  });
});

// --- Forward: every name the registry cites exists -----------------------------------------------

describe("every registered name exists in the place it is cited from", () => {
  for (const m of allMembers) {
    it(`${m.entry.key}: ${m.surface} ${m.name}`, () => {
      expect(exists(m.surface, m.name), `${m.name} is not defined on ${m.surface}`).toBe(true);
    });
  }
  for (const x of allExcluded) {
    it(`${x.entry.key} excludes ${x.surface} ${x.name}`, () => {
      expect(exists(x.surface, x.name), `${x.name} is not defined on ${x.surface}`).toBe(true);
    });
  }
});

// --- Units and spans agree with the source -------------------------------------------------------

describe("each name's unit and span match what its source states", () => {
  it("pro forma cells and pack pro forma inputs", () => {
    for (const m of allMembers) {
      if (m.surface === "proforma_cell") expect(m.unit, m.name).toBe(deskCells.get(m.name)!.unit);
      if (m.surface === "pack_proforma") expect(m.unit, m.name).toBe(packProforma.get(m.name)!.unit);
    }
  });

  it("pack bindings state the binding's default unit, which the binding allows", () => {
    for (const m of allMembers.filter((x) => x.surface === "pack_binding")) {
      const b = packBindingPaths.get(m.name)!;
      expect(m.unit, m.name).toBe(b.defaultUnit);
      expect(b.units, m.name).toContain(m.unit);
    }
  });

  it("typed readings state the unit the reading asks for, and a daily series is declared daily", () => {
    for (const m of allMembers.filter((x) => x.surface === "desk_manual")) {
      const spec = deskManual.get(m.name)!;
      expect(m.unit, m.name).toBe(spec.unit);
      expect(m.period === "daily_series", `${m.name} daily`).toBe(spec.kind === "daily");
    }
  });

  it("a pack pro forma input and the desk-review cell it is paired with read the same row", () => {
    const pairs = allMembers.filter((m) => m.pairedWith);
    expect(pairs.length).toBeGreaterThan(0);
    for (const m of pairs) {
      const pack = packProforma.get(m.name)!;
      const desk = deskCells.get(m.pairedWith!)!;
      expect(desk, `${m.pairedWith} is not a desk-review cell`).toBeDefined();
      expect({ sheet: desk.sheet, label: desk.label, unit: desk.unit, scale: desk.scale ?? 1 }, `${m.name} vs ${m.pairedWith}`).toEqual({
        sheet: pack.sheet,
        label: pack.label,
        unit: pack.unit,
        scale: pack.scale ?? 1,
      });
    }
  });
});

// --- Extraction to pack binding: recomputed, not trusted -----------------------------------------

/** Whether an extracted leaf becomes a fact path that one of the given pack binding paths reads. */
function binds(leaf: string, withFuelKind: string | null, paths: string[]): boolean {
  const fields = [...(withFuelKind ? [{ fieldPath: "fuelKind", value: withFuelKind }] : []), { fieldPath: leaf, value: 1 }];
  const out = qualifyExtractedFieldPaths(fields).find((f) => f.fieldPath !== "fuelKind")!.fieldPath;
  return paths.some((p) => matchFactPath(out, p));
}

describe("what an extracted field becomes, against what the pack reads", () => {
  const packPathsOf = (e: RegistryEntry) => membersOn(e, "pack_binding").map((m) => m.name);

  for (const e of entries) {
    for (const m of membersOn(e, "extraction_field")) {
      it(`${e.key}: ${m.name} binds ${m.packBinds}`, () => {
        const [docType, leaf] = m.name.split(".") as [string, string];
        const plain = binds(leaf, null, packPathsOf(e));
        // A fuel kind only enters the picture for a document whose schema carries one (a fuel invoice does,
        // a lab certificate does not).
        const coal = extractionLeaves.has(`${docType}.fuelKind`) ? binds(leaf, "coal", packPathsOf(e)) : plain;
        const actual = plain && coal ? "always" : plain ? "only_without_fuel_kind" : "never";
        expect(actual).toBe(m.packBinds);
      });
    }
    for (const x of e.excluded.filter((y) => y.surface === "extraction_field")) {
      it(`${e.key}: excluded ${x.name} lands on a pack binding = ${x.landsOnPackBinding}`, () => {
        const leaf = x.name.split(".")[1]!;
        expect(binds(leaf, null, [...packBindingPaths.keys()])).toBe(Boolean(x.landsOnPackBinding));
      });
    }
  }
});

// --- Reverse: a new name for one of these quantities must be classified --------------------------

const CANDIDATE = /clinker|gcv|grid|activeEnergy|calorific/i;

function candidates(): { surface: Surface; name: string }[] {
  const out = new Map<string, { surface: Surface; name: string }>();
  const add = (surface: Surface, name: string) => {
    if (CANDIDATE.test(name)) out.set(`${surface}:${name}`, { surface, name });
  };
  for (const k of deskManual.keys()) add("desk_manual", k);
  for (const k of deskCells.keys()) add("proforma_cell", k);
  for (const n of ruleNeeds) {
    if (deskCells.has(n) || deskManual.has(n)) continue;
    const base = n.endsWith("@*") ? n.slice(0, -2) : n;
    if (deskManual.has(base)) continue; // a typed daily series, already counted as a manual reading
    add("desk_reader", n);
  }
  for (const k of packBindingPaths.keys()) add("pack_binding", k);
  for (const k of packProforma.keys()) add("pack_proforma", k);
  for (const k of extractionLeaves) add("extraction_field", k);
  return [...out.values()];
}

describe("a name that looks like one of these quantities is registered or explicitly excluded", () => {
  const classified = new Set([...allMembers, ...allExcluded].map((x) => `${x.surface}:${x.name}`));
  const found = candidates();

  it("finds the candidates it is meant to guard", () => {
    expect(found.length).toBeGreaterThan(20);
  });

  it("leaves no candidate unclassified", () => {
    const loose = found.filter((c) => !classified.has(`${c.surface}:${c.name}`)).map((c) => `${c.surface}:${c.name}`);
    expect(loose, `Unclassified: add each to a registry entry as a member, or to its excluded list with a reason`).toEqual([]);
  });

  it("each registered key has members on desk review and on the other surfaces it is meant to link", () => {
    for (const e of entries) {
      expect(membersOn(e, "proforma_cell").length + membersOn(e, "desk_manual").length + membersOn(e, "desk_reader").length, e.key).toBeGreaterThan(0);
    }
    // The finding worth knowing: clinker has no pack binding and no extraction field.
    const clinker = entries.find((e) => e.key === "clinker_production")!;
    expect(membersOn(clinker, "pack_binding")).toHaveLength(0);
    expect(membersOn(clinker, "extraction_field")).toHaveLength(0);
    expect(entryFor(CEMENT_REGISTRY, "pack_binding", "production")).toBeNull();
  });
});
