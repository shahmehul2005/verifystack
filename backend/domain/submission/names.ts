/** A filename safe to place inside an archive: ASCII letters, digits, dot, dash, underscore. */
export function sanitizeArchiveName(raw: string): string {
  const base = raw.replace(/^.*[\\/]/, "");
  const cleaned = base
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w.\-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[.-]+/, "")
    .slice(0, 80);
  return cleaned || "file";
}
