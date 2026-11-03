import type { MethodologyPack, PackQuantityBinding } from "./types";

export interface FieldTarget {
  path: string;
  label: string;
  defaultUnit: string;
}

/**
 * The fact paths a pack reads, with a human label and the unit it expects. Used
 * to offer the right names when mapping a spreadsheet cell or a time-series
 * window, so a value lands on a path the calculation actually binds.
 */
export function packFieldTargets(pack: MethodologyPack): FieldTarget[] {
  const out = new Map<string, FieldTarget>();
  const add = (b: PackQuantityBinding | undefined, label: string) => {
    if (!b?.path || out.has(b.path)) return;
    out.set(b.path, { path: b.path, label, defaultUnit: b.defaultUnit });
  };
  for (const s of pack.stream_bindings ?? []) {
    add(s.quantity, `${s.label}: quantity`);
    if ("calorificValue" in s) add(s.calorificValue, `${s.label}: calorific value`);
  }
  for (const e of pack.energy_bindings ?? []) {
    add(e.quantity, `${e.label}: quantity`);
    add(e.calorificValue, `${e.label}: calorific value`);
  }
  add(pack.demand_binding?.contractedDemand, "Contracted demand");
  add(pack.demand_binding?.maximumDemand, "Maximum demand");
  if (pack.production_binding) {
    const p = pack.production_binding;
    out.set(p.path, {
      path: p.path,
      label: `${p.productLabel}: production`,
      defaultUnit: p.defaultUnit,
    });
  }
  return [...out.values()];
}
