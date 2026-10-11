/**
 * Site fieldwork and evidence capture (DFD 14.0, store D13).
 *
 * A site visit produces observations: a meter reading, a nameplate, a note on
 * the process, a photograph, an interview. Each is recorded with who saw it,
 * when, and where, and can carry photographs. An observation that names a field
 * and a value becomes a *proposal* in the review queue with site-observation
 * provenance; it is not a fact until someone other than the observer accepts it.
 *
 * Capture can happen with no signal (see queue.ts), so every observation has a
 * client-generated id. The server treats that id as an idempotency key: syncing
 * the same observation twice records it once.
 *
 * Timestamps: `observedAt` is the device clock at capture, which is what a
 * verifier means by "when I read the meter". `recordedAt` is set by the server
 * and is the one an auditor trusts. Both are kept, and a large gap is shown.
 */

import { z } from "zod";
import type { SiteObservationProvenance } from "../provenance";

export const OBSERVATION_KINDS = ["meter_reading", "nameplate", "process_note", "photo", "interview"] as const;
export type ObservationKind = (typeof OBSERVATION_KINDS)[number];

export const OBSERVATION_KIND_LABEL: Record<ObservationKind, string> = {
  meter_reading: "Meter reading",
  nameplate: "Nameplate",
  process_note: "Process note",
  photo: "Photograph",
  interview: "Interview",
};

/** A device clock may run ahead by this much before the observation is refused. */
export const MAX_CLOCK_SKEW_MS = 10 * 60 * 1000;
/** Observations older than this are refused: stale captures belong in a document upload. */
export const MAX_OBSERVATION_AGE_MS = 90 * 86_400_000;
/** Positional accuracy worse than this is accepted but flagged. */
export const WEAK_ACCURACY_M = 200;

export const ObservationInputSchema = z
  .object({
    clientId: z.string().uuid(),
    kind: z.enum(OBSERVATION_KINDS),
    observedAt: z.string().max(40),
    visitId: z.string().uuid().nullable().optional(),
    location: z
      .object({
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
        accuracyM: z.number().nonnegative().max(100_000).optional(),
      })
      .nullable()
      .optional(),
    fieldPath: z.string().trim().min(1).max(200).nullable().optional(),
    value: z.union([z.number().finite(), z.string().trim().min(1).max(500)]).nullable().optional(),
    unit: z.string().trim().max(30).nullable().optional(),
    note: z.string().trim().max(2000).nullable().optional(),
    evidenceFileIds: z.array(z.string().uuid()).max(20).default([]),
  })
  .superRefine((o, ctx) => {
    const add = (message: string, path: string) => ctx.addIssue({ code: "custom", message, path: [path] });
    if (o.kind === "meter_reading") {
      if (typeof o.value !== "number") add("A meter reading needs a numeric value.", "value");
      if (!o.unit) add("A meter reading needs a unit.", "unit");
      if (!o.fieldPath) add("Say which field this reading is for.", "fieldPath");
    }
    if (o.kind === "nameplate" && !o.note) add("Record what the nameplate says.", "note");
    if ((o.kind === "process_note" || o.kind === "interview") && (o.note ?? "").length < 10) {
      add("Write what you observed or were told.", "note");
    }
    if (o.kind === "photo" && o.evidenceFileIds.length === 0) add("Attach the photograph.", "evidenceFileIds");
    if (o.value !== undefined && o.value !== null && o.fieldPath && o.kind !== "meter_reading" && typeof o.value === "number" && !o.unit) {
      add("A numeric value needs a unit.", "unit");
    }
  });

export type ObservationInput = z.infer<typeof ObservationInputSchema>;

export interface ObservationCheck {
  ok: boolean;
  errors: string[];
  warnings: string[];
  observedAtMs: number | null;
}

/** Time and place checks that need a clock, so they are kept out of the schema. */
export function checkObservation(input: ObservationInput, now: Date = new Date()): ObservationCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  const ms = Date.parse(input.observedAt);
  if (!Number.isFinite(ms)) {
    return { ok: false, errors: ["The observation time is not a valid date."], warnings, observedAtMs: null };
  }
  if (ms > now.getTime() + MAX_CLOCK_SKEW_MS) {
    errors.push("The observation time is in the future. Check the device clock.");
  }
  if (now.getTime() - ms > MAX_OBSERVATION_AGE_MS) {
    errors.push("The observation is more than 90 days old. Upload it as a document instead.");
  }
  if (input.location?.accuracyM && input.location.accuracyM > WEAK_ACCURACY_M) {
    warnings.push(`Location accuracy is ${Math.round(input.location.accuracyM)} m, which is too coarse to place the reading at the meter.`);
  }
  if (!input.location) warnings.push("No location was captured.");
  return { ok: errors.length === 0, errors, warnings, observedAtMs: ms };
}

/** The hours between capture and server record, shown when a sync was late. */
export function captureDelayHours(observedAtMs: number, recordedAt: Date): number {
  return Math.max(0, (recordedAt.getTime() - observedAtMs) / 3_600_000);
}

/** Whether the observation names a field and a value, so it can enter the review queue. */
export function isProposable(o: Pick<ObservationInput, "fieldPath" | "value">): boolean {
  return Boolean(o.fieldPath) && o.value !== null && o.value !== undefined;
}

export function toSiteProvenance(
  o: ObservationInput,
  ctx: { observationId: string; observer: string }
): SiteObservationProvenance & { type: "site_observation" } {
  return {
    type: "site_observation",
    observationId: ctx.observationId,
    observer: ctx.observer,
    timestamp: new Date(Date.parse(o.observedAt)).toISOString(),
    ...(o.location
      ? {
          location: {
            lat: o.location.lat,
            lng: o.location.lng,
            ...(o.location.accuracyM !== undefined ? { accuracyM: o.location.accuracyM } : {}),
          },
        }
      : {}),
    evidenceFileIds: o.evidenceFileIds,
  };
}

/** The sentence a reviewer sees beside a proposed value from the field. */
export function observationSummary(o: ObservationInput, observer: string): string {
  const what = o.value !== null && o.value !== undefined ? `${o.value}${o.unit ? ` ${o.unit}` : ""}` : (o.note ?? "").slice(0, 120);
  return `${OBSERVATION_KIND_LABEL[o.kind]} by ${observer}: ${what}`;
}

/**
 * Accepting a site observation as a fact needs a second person. The observer
 * saw it; someone else decides whether it stands. Same principle as sign-off.
 */
export function assertAccepterIndependent(observerUserId: string, accepterUserId: string): void {
  if (observerUserId === accepterUserId) {
    throw new ObservationError(
      "You recorded this observation, so someone else has to accept it as a fact."
    );
  }
}

export class ObservationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ObservationError";
  }
}
