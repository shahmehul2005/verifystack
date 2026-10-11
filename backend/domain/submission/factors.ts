/**
 * Which emission or energy factors a stored calculation result relied on without
 * their being marked verified. A submission package always discloses these.
 *
 * Walks the result generically (every `factorsUsed` array at any depth) so it
 * covers GEI and SEC results and any method added later without a new case.
 */
export function collectUnverifiedFactors(result: unknown): string[] {
  const found = new Set<string>();
  const seen = new Set<unknown>();

  const visit = (node: unknown, depth: number) => {
    if (depth > 12 || node === null || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const item of node) visit(item, depth + 1);
      return;
    }
    const obj = node as Record<string, unknown>;
    const used = obj.factorsUsed;
    if (Array.isArray(used)) {
      for (const f of used) {
        if (f && typeof f === "object") {
          const r = f as { id?: unknown; vintage?: unknown; verified?: unknown };
          if (r.verified === false && typeof r.id === "string") {
            found.add(typeof r.vintage === "string" ? `${r.id}@${r.vintage}` : r.id);
          }
        }
      }
    }
    for (const v of Object.values(obj)) visit(v, depth + 1);
  };

  visit(result, 0);
  return [...found].sort();
}
