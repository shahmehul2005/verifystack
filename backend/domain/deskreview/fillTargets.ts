/**
 * Which readings a waiting check needs the auditor to type, so the drawer can
 * take them straight to the right cards. A check lists what it is missing as
 * reading keys. Some of those are typed in the Corroboration drawer; the rest
 * are read from uploaded spreadsheets by code and cannot be typed anywhere.
 */

export interface FillTargets {
  /** Drawer card keys to point at, in the order the check lists them, each once. */
  cards: string[];
  /** Missing readings that are not typed in the drawer, as the check names them. */
  elsewhere: string[];
}

/** `dpr.clinker@*` and `dpr.clinker@2023-11-01` are both the daily reading `dpr.clinker`. */
const baseKey = (key: string) => key.split("@")[0]!;

export function fillTargets(missing: readonly string[], manualKeys: readonly string[]): FillTargets {
  const typed = new Set(manualKeys);
  const cards: string[] = [];
  const elsewhere: string[] = [];
  for (const key of missing) {
    const base = baseKey(key);
    if (typed.has(base)) {
      if (!cards.includes(base)) cards.push(base);
    } else if (!elsewhere.includes(key)) {
      elsewhere.push(key);
    }
  }
  return { cards, elsewhere };
}
