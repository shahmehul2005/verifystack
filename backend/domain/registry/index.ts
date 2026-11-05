import type { Registry, RegistryEntry, RegistryMember, Surface } from "./types";

export type { Registry, RegistryEntry, RegistryMember, RegistryExclusion, Surface, Period, Basis, Dimension } from "./types";
export { CEMENT_REGISTRY } from "./cement";

/** The entry a name belongs to, or null. A name is a member of at most one entry. */
export function entryFor(registry: Registry, surface: Surface, name: string): RegistryEntry | null {
  return registry.entries.find((e) => e.members.some((m) => m.surface === surface && m.name === name)) ?? null;
}

export function memberFor(registry: Registry, surface: Surface, name: string): RegistryMember | null {
  for (const e of registry.entries) {
    const hit = e.members.find((m) => m.surface === surface && m.name === name);
    if (hit) return hit;
  }
  return null;
}

/** Every member of one entry on one surface. */
export function membersOn(entry: RegistryEntry, surface: Surface): RegistryMember[] {
  return entry.members.filter((m) => m.surface === surface);
}
