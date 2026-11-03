import { describe, expect, it } from "vitest";
import {
  assertAccepterIndependent,
  captureDelayHours,
  checkObservation,
  isProposable,
  ObservationError,
  ObservationInputSchema,
  observationSummary,
  toSiteProvenance,
  type ObservationInput,
} from "./observation";
import {
  applyOutcome,
  discardItem,
  dueItems,
  enqueue,
  MAX_QUEUE_ITEMS,
  parseQueue,
  queueSummary,
  reviseItem,
} from "./queue";
import { provenanceFromColumns, provenanceToColumns } from "../provenance";

const NOW = new Date("2026-10-09T10:00:00Z");
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function obs(over: Partial<ObservationInput> = {}): ObservationInput {
  return ObservationInputSchema.parse({
    clientId: id(1),
    kind: "meter_reading",
    observedAt: "2026-10-09T09:30:00Z",
    fieldPath: "electricity.activeEnergy",
    value: 123456.7,
    unit: "kWh",
    location: { lat: 19.07, lng: 72.87, accuracyM: 12 },
    ...over,
  });
}

describe("ObservationInputSchema", () => {
  it("requires a value, unit and field for a meter reading", () => {
    const r = ObservationInputSchema.safeParse({ clientId: id(1), kind: "meter_reading", observedAt: "2026-10-09T09:00:00Z" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues.map((i) => i.path[0])).toEqual(expect.arrayContaining(["value", "unit", "fieldPath"]));
  });
  it("needs a note for nameplates, interviews and process notes and a file for photographs", () => {
    expect(ObservationInputSchema.safeParse({ clientId: id(1), kind: "nameplate", observedAt: "2026-10-09T09:00:00Z" }).success).toBe(false);
    expect(ObservationInputSchema.safeParse({ clientId: id(1), kind: "interview", observedAt: "2026-10-09T09:00:00Z", note: "short" }).success).toBe(false);
    expect(ObservationInputSchema.safeParse({ clientId: id(1), kind: "photo", observedAt: "2026-10-09T09:00:00Z" }).success).toBe(false);
    expect(ObservationInputSchema.safeParse({ clientId: id(1), kind: "photo", observedAt: "2026-10-09T09:00:00Z", evidenceFileIds: [id(9)] }).success).toBe(true);
  });
});

describe("checkObservation", () => {
  it("passes a recent, located reading", () => {
    expect(checkObservation(obs(), NOW)).toMatchObject({ ok: true, errors: [], warnings: [] });
  });
  it("refuses a future time, a stale one and a bad date", () => {
    expect(checkObservation(obs({ observedAt: "2026-10-09T12:00:00Z" }), NOW).errors[0]).toMatch(/future/);
    expect(checkObservation(obs({ observedAt: "2026-06-01T00:00:00Z" }), NOW).errors[0]).toMatch(/90 days/);
    expect(checkObservation(obs({ observedAt: "not a date" }), NOW).ok).toBe(false);
  });
  it("tolerates a few minutes of clock skew", () => {
    expect(checkObservation(obs({ observedAt: "2026-10-09T10:05:00Z" }), NOW).ok).toBe(true);
  });
  it("warns, not blocks, on weak or missing location", () => {
    expect(checkObservation(obs({ location: { lat: 1, lng: 1, accuracyM: 900 } }), NOW).warnings[0]).toMatch(/too coarse/);
    expect(checkObservation(obs({ location: null }), NOW).warnings[0]).toMatch(/No location/);
  });
  it("measures capture delay", () => {
    expect(captureDelayHours(Date.parse("2026-10-09T06:00:00Z"), NOW)).toBe(4);
    expect(captureDelayHours(Date.parse("2026-10-09T11:00:00Z"), NOW)).toBe(0);
  });
});

describe("provenance and independence", () => {
  it("builds provenance that round-trips through the stored columns", () => {
    const p = toSiteProvenance(obs(), { observationId: id(7), observer: "R. Iyer" });
    expect(provenanceFromColumns(provenanceToColumns(p))).toEqual(p);
    expect(p.timestamp).toBe("2026-10-09T09:30:00.000Z");
  });
  it("describes the proposal and knows when one can be made", () => {
    expect(observationSummary(obs(), "R. Iyer")).toBe("Meter reading by R. Iyer: 123456.7 kWh");
    expect(isProposable(obs())).toBe(true);
    expect(isProposable({ fieldPath: null, value: 5 })).toBe(false);
  });
  it("stops the observer accepting their own observation", () => {
    expect(() => assertAccepterIndependent("u1", "u1")).toThrow(ObservationError);
    expect(() => assertAccepterIndependent("u1", "u2")).not.toThrow();
  });
});

describe("offline queue", () => {
  it("is idempotent on clientId and bounded", () => {
    let q = enqueue([], obs(), NOW);
    q = enqueue(q, obs(), NOW);
    expect(q).toHaveLength(1);
    let full = q;
    for (let i = 2; full.length < MAX_QUEUE_ITEMS; i++) full = enqueue(full, obs({ clientId: id(i) }), NOW);
    expect(() => enqueue(full, obs({ clientId: id(9999) }), NOW)).toThrow(RangeError);
  });

  it("syncs in capture order", () => {
    let q = enqueue([], obs({ clientId: id(2), observedAt: "2026-10-09T09:45:00Z" }), NOW);
    q = enqueue(q, obs({ clientId: id(1), observedAt: "2026-10-09T09:15:00Z" }), NOW);
    expect(dueItems(q, NOW).map((x) => x.clientId)).toEqual([id(1), id(2)]);
  });

  it("removes on saved or duplicate, backs off on transient failure, parks a rejection", () => {
    let q = enqueue([], obs(), NOW);
    q = applyOutcome(q, id(1), { kind: "retry", reason: "offline" }, NOW);
    expect(q[0]!.attempts).toBe(1);
    expect(dueItems(q, NOW)).toHaveLength(0);
    expect(dueItems(q, new Date(NOW.getTime() + 6_000))).toHaveLength(1);
    q = applyOutcome(q, id(1), { kind: "retry", reason: "offline" }, NOW);
    expect(Date.parse(q[0]!.nextAttemptAt!) - NOW.getTime()).toBe(10_000);

    q = applyOutcome(q, id(1), { kind: "rejected", reason: "Time is in the future" }, NOW);
    expect(dueItems(q, new Date(NOW.getTime() + 1e9))).toHaveLength(0);
    expect(queueSummary(q)).toEqual({ pending: 0, rejected: 1 });

    q = reviseItem(q, id(1), obs({ observedAt: "2026-10-09T09:00:00Z" }));
    expect(dueItems(q, NOW)).toHaveLength(1);
    expect(applyOutcome(q, id(1), { kind: "saved" }, NOW)).toEqual([]);
    expect(applyOutcome(q, id(1), { kind: "duplicate" }, NOW)).toEqual([]);
    expect(discardItem(q, id(1))).toEqual([]);
  });

  it("caps the retry delay", () => {
    let q = enqueue([], obs(), NOW);
    for (let i = 0; i < 20; i++) q = applyOutcome(q, id(1), { kind: "retry", reason: "x" }, NOW);
    expect(Date.parse(q[0]!.nextAttemptAt!) - NOW.getTime()).toBe(15 * 60_000);
  });

  it("starts empty from corrupt storage", () => {
    expect(parseQueue(null)).toEqual([]);
    expect(parseQueue("{bad")).toEqual([]);
    expect(parseQueue('{"a":1}')).toEqual([]);
    expect(parseQueue(JSON.stringify([{ clientId: "a", payload: {} }, 5]))).toHaveLength(1);
  });
});
