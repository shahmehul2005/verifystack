import { describe, expect, it } from "vitest";
import {
  assertReviewerIndependent,
  assertReviewInput,
  assertTechnicalReviewAllowsSignoff,
  draftersOf,
  evaluateTechnicalReview,
  reviewSnapshotHash,
  TechnicalReviewError,
  type ReviewRecord,
} from "./technical";

const facts = [
  { id: "b", value_json: 2, unit: "t" },
  { id: "a", value_json: 1, unit: "kWh" },
];

describe("reviewSnapshotHash", () => {
  it("ignores fact order and changes with any value, unit or run", () => {
    const h = reviewSnapshotHash({ runInputHash: "r1", facts });
    expect(reviewSnapshotHash({ runInputHash: "r1", facts: [...facts].reverse() })).toBe(h);
    expect(reviewSnapshotHash({ runInputHash: "r2", facts })).not.toBe(h);
    expect(reviewSnapshotHash({ runInputHash: "r1", facts: [{ ...facts[0]!, value_json: 3 }, facts[1]!] })).not.toBe(h);
    expect(reviewSnapshotHash({ runInputHash: "r1", facts: [{ ...facts[0]!, unit: "kg" }, facts[1]!] })).not.toBe(h);
    expect(reviewSnapshotHash({ runInputHash: "r1", facts: facts.slice(1) })).not.toBe(h);
  });
});

const rec = (over: Partial<ReviewRecord>): ReviewRecord => ({
  id: "x",
  reviewer_user_id: "u2",
  decision: "approved",
  snapshot_hash: "S",
  created_at: "2026-10-01T00:00:00Z",
  ...over,
});

describe("evaluateTechnicalReview", () => {
  it("is not required and silent when the pack does not ask and nothing was recorded", () => {
    expect(evaluateTechnicalReview({ required: false, reviews: [], currentSnapshotHash: "S" })).toMatchObject({
      status: "not_required",
      blocks: false,
    });
  });

  it("blocks when required and missing", () => {
    const s = evaluateTechnicalReview({ required: true, reviews: [], currentSnapshotHash: "S" });
    expect(s.status).toBe("missing");
    expect(() => assertTechnicalReviewAllowsSignoff(s)).toThrow(TechnicalReviewError);
  });

  it("accepts a current approval", () => {
    const s = evaluateTechnicalReview({ required: true, reviews: [rec({})], currentSnapshotHash: "S" });
    expect(s).toMatchObject({ status: "approved", blocks: false });
    expect(() => assertTechnicalReviewAllowsSignoff(s)).not.toThrow();
  });

  it("treats an approval as stale once the work changed", () => {
    const s = evaluateTechnicalReview({ required: true, reviews: [rec({})], currentSnapshotHash: "T" });
    expect(s.status).toBe("stale");
    expect(s.blocks).toBe(true);
    expect(evaluateTechnicalReview({ required: false, reviews: [rec({})], currentSnapshotHash: "T" }).blocks).toBe(false);
  });

  it("lets a current changes-requested review block even when review is optional", () => {
    const s = evaluateTechnicalReview({
      required: false,
      reviews: [rec({ decision: "changes_requested" })],
      currentSnapshotHash: "S",
    });
    expect(s).toMatchObject({ status: "changes_requested", blocks: true });
  });

  it("uses the newest review whatever the order, so a later approval clears an earlier request", () => {
    const reviews = [
      rec({ id: "new", decision: "approved", created_at: "2026-10-03T00:00:00Z" }),
      rec({ id: "old", decision: "changes_requested", created_at: "2026-10-02T00:00:00Z" }),
    ];
    expect(evaluateTechnicalReview({ required: true, reviews, currentSnapshotHash: "S" }).status).toBe("approved");
    expect(evaluateTechnicalReview({ required: true, reviews: [...reviews].reverse(), currentSnapshotHash: "S" }).status).toBe(
      "approved"
    );
  });
});

describe("independence and input", () => {
  it("bars anyone who accepted a fact or ran the calculation", () => {
    const drafters = draftersOf({ factAcceptors: ["u1", null, "u3"], runCreators: ["u4", undefined] });
    expect([...drafters].sort()).toEqual(["u1", "u3", "u4"]);
    expect(() => assertReviewerIndependent("u3", drafters)).toThrow(/cannot be its technical reviewer/);
    expect(() => assertReviewerIndependent("u9", drafters)).not.toThrow();
  });

  it("requires reasons for changes and a note for approval", () => {
    expect(() => assertReviewInput("changes_requested", "no")).toThrow(TechnicalReviewError);
    expect(() => assertReviewInput("changes_requested", "Fuel invoice 12 is counted twice.")).not.toThrow();
    expect(() => assertReviewInput("approved", "   ")).toThrow(TechnicalReviewError);
    expect(() => assertReviewInput("approved", "Checked bindings.")).not.toThrow();
  });
});
