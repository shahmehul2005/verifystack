/**
 * Field catalogue for the extractor service.
 *
 * Walks an extraction schema (Zod 4) and lists every provenanced leaf as a
 * path, a kind and, for enums, the allowed options. The service fills exactly
 * these paths. Array elements use a `*` segment (`lines.*.description`).
 *
 * A leaf is an object with `value`, `confidence` and `provenance`. The kind
 * comes from the `value` schema, or is `measure` when the leaf also has
 * `unitAsPrinted`.
 */

import { z } from "zod";
import { CONFIDENCE_POLICY } from "./schemas";

export type CatalogueKind = "number" | "measure" | "date" | "enum" | "string";

export interface CatalogueEntry {
  path: string;
  kind: CatalogueKind;
  /** Allowed values, for kind "enum". */
  options?: string[];
  /** Always set to true for high-materiality fields; omitted otherwise. */
  regulatory?: true;
}

const DATE_KEY = /date|periodStart|periodEnd|validUntil/i;

/** Strip optional, nullable (and so nullish) and default wrappers. */
function unwrap(schema: z.ZodType): z.ZodType {
  let current = schema;
  for (;;) {
    if (current instanceof z.ZodOptional || current instanceof z.ZodNullable) {
      current = current.unwrap() as z.ZodType;
    } else if (current instanceof z.ZodDefault) {
      current = current.unwrap() as z.ZodType;
    } else {
      return current;
    }
  }
}

function isProvenancedLeaf(shape: Record<string, z.ZodType>): boolean {
  return "value" in shape && "confidence" in shape && "provenance" in shape;
}

function leafKind(shape: Record<string, z.ZodType>, key: string): { kind: CatalogueKind; options?: string[] } {
  if ("unitAsPrinted" in shape) return { kind: "measure" };
  const value = unwrap(shape.value);
  if (value instanceof z.ZodNumber) return { kind: "number" };
  if (value instanceof z.ZodEnum) return { kind: "enum", options: value.options.map(String) };
  if (DATE_KEY.test(key)) return { kind: "date" };
  return { kind: "string" };
}

function walk(schema: z.ZodType, path: string, out: CatalogueEntry[]): void {
  const node = unwrap(schema);

  if (node instanceof z.ZodArray) {
    walk(node.element as z.ZodType, path ? `${path}.*` : "*", out);
    return;
  }

  if (!(node instanceof z.ZodObject)) return;
  const shape = node.shape as Record<string, z.ZodType>;

  if (isProvenancedLeaf(shape)) {
    const key = path.split(".").pop() ?? path;
    const { kind, options } = leafKind(shape, key);
    const entry: CatalogueEntry = { path, kind };
    if (options) entry.options = options;
    if (CONFIDENCE_POLICY.alwaysReview.has(key)) entry.regulatory = true;
    out.push(entry);
    return;
  }

  for (const [key, child] of Object.entries(shape)) {
    walk(child, path ? `${path}.${key}` : key, out);
  }
}

export function fieldCatalogue(schema: z.ZodType): CatalogueEntry[] {
  const out: CatalogueEntry[] = [];
  walk(schema, "", out);
  return out;
}
