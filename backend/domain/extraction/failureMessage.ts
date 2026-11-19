/**
 * User-facing text for a failed provider call. Pure and client-safe.
 * `failure.message` comes from the extractor client and carries only the status,
 * code and category, never the URL, key or raw response text.
 */

import type { ProviderFailure } from "./provider";

export type FailureStage = "classification" | "extraction";

export function describeFailure(failure: ProviderFailure, stage: FailureStage): string {
  switch (failure.kind) {
    case "timeout":
      return "The extractor service timed out. It may be waking up from sleep; try again in a minute.";
    case "auth":
      return "The extractor rejected the key. EXTRACTOR_API_KEY on Vercel must match the one on the extractor service.";
    case "model_unavailable":
      return "The extractor's model is not configured (check the provider key on the extractor service).";
    case "service":
      return `The extractor service failed (${failure.message}). Check the service logs and that EXTRACTOR_MODEL matches EXTRACTOR_PROVIDER.`;
    case "invalid_response":
      return "The extractor service returned a response this app could not read. Check that the service and the app are on matching versions.";
    case "too_large":
      return "The document is too large for the extractor service.";
    case "unsupported":
      return "The extractor service does not support this file type. Use PDF, PNG, or JPEG.";
    case "unprocessable":
      return "The extractor service could not process this document.";
    case "not_configured":
      return "The extractor service is not configured. Set EXTRACTOR_URL and EXTRACTOR_API_KEY.";
    case "schema_validation":
      return stage === "extraction"
        ? `Field extraction failed schema validation.${failure.message ? ` ${failure.message}` : ""}`
        : `Classification failed. ${failure.message}`.trim();
  }
}

interface FailedResult {
  failure?: ProviderFailure;
  validationErrors?: string[];
  log: { error?: string };
}

/** Message stored on a failed classification job and returned to the caller. */
export function classificationFailureMessage(r: FailedResult): string {
  if (r.failure) return describeFailure(r.failure, "classification");
  if (r.validationErrors?.length) {
    return `Classification failed. ${r.validationErrors.slice(0, 4).join("; ")}`;
  }
  if (r.log.error) return `Classification failed. ${r.log.error}`;
  return "Classification failed. The model could not identify this document type.";
}

/** Message stored on a job whose every page failed field extraction. */
export function extractionFailureMessage(r: FailedResult | undefined): string {
  if (r?.failure) return describeFailure(r.failure, "extraction");
  if (r?.validationErrors?.length) {
    return `Field extraction failed schema validation. ${r.validationErrors.slice(0, 4).join("; ")}`;
  }
  if (r?.log.error) return `Field extraction failed. ${r.log.error}`;
  return "Field extraction failed on every page.";
}
