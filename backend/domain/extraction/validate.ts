/**
 * Shared validation of raw model output, used by every extraction provider.
 */

import type { z } from "zod";
import { softenExtraction } from "./soften";
import type { AiActionLog, ExtractionResult } from "./provider";

export function stripCodeFence(raw: string): string {
  const trimmed = raw.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/;
  const m = trimmed.match(fence);
  return m ? m[1] : trimmed;
}

export function validate<T extends z.ZodTypeAny>(
  schema: T,
  raw: string,
  log: AiActionLog,
  opts: { soften: boolean }
): ExtractionResult<z.infer<T>> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFence(raw));
  } catch {
    return {
      ok: false,
      validationErrors: ["Model output was not valid JSON"],
      log: { ...log, ok: false, error: "invalid_json" },
    };
  }

  const payload = opts.soften
    ? softenExtraction(parsed, log.pageNumber ?? 1)
    : parsed;
  const result = schema.safeParse(payload);
  if (!result.success) {
    if (opts.soften && payload && typeof payload === "object") {
      return {
        ok: true,
        data: payload as z.infer<T>,
        validationErrors: result.error.issues.map(
          (i) => `${i.path.join(".") || "(root)"}: ${i.message}`
        ),
        log: {
          ...log,
          ok: true,
          error: `Partial extraction with validation warnings: ${result.error.issues.map((i) => i.message).slice(0, 3).join("; ")}`,
        },
      };
    }
    return {
      ok: false,
      validationErrors: result.error.issues.map(
        (i) => `${i.path.join(".") || "(root)"}: ${i.message}`
      ),
      log: { ...log, ok: false, error: "schema_validation_failed" },
    };
  }
  return { ok: true, data: result.data, log };
}
