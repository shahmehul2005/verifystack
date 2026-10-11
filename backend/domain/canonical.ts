/**
 * Canonical JSON and SHA-256, shared by every record that is hashed for
 * reproducibility (savings runs, technical-review snapshots, submission
 * manifests). Object keys are sorted at every depth so the same content always
 * produces the same bytes, whatever order it was built in.
 */

import { createHash } from "node:crypto";

export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_k, v) => {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      return Object.keys(v as Record<string, unknown>)
        .sort()
        .reduce<Record<string, unknown>>((acc, k) => {
          acc[k] = (v as Record<string, unknown>)[k];
          return acc;
        }, {});
    }
    return v;
  });
}

export function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

export function hashCanonical(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}
