import { describe, expect, it } from "vitest";
import {
  ageing,
  allowedTransitions,
  assertTransition,
  canTransition,
  defaultDueDate,
  isBlockingOpen,
  IssueTransitionError,
  summariseIssues,
} from "./lifecycle";

describe("transitions", () => {
  it("walks the full path for a block issue", () => {
    const path = ["suggested", "accepted", "open", "responded", "verified", "closed"] as const;
    for (let i = 0; i < path.length - 1; i++) {
      expect(canTransition(path[i]!, path[i + 1]!, "block")).toBe(true);
    }
  });

  it("does not let a block issue close straight from a decided draft", () => {
    expect(canTransition("accepted", "closed", "block")).toBe(false);
    expect(() => assertTransition("accepted", "closed", "block")).toThrow(/answered and verified/);
    expect(canTransition("edited", "closed", "block")).toBe(false);
  });

  it("lets warn and info issues close from a decided draft", () => {
    expect(canTransition("accepted", "closed", "warn")).toBe(true);
    expect(canTransition("edited", "closed", "info")).toBe(true);
  });

  it("sends an insufficient response back to open and never leaves a terminal state", () => {
    expect(canTransition("responded", "open", "block")).toBe(true);
    expect(allowedTransitions("closed", "block")).toEqual([]);
    expect(allowedTransitions("rejected", "warn")).toEqual([]);
  });

  it("cannot skip the response", () => {
    expect(canTransition("open", "verified", "block")).toBe(false);
    expect(canTransition("open", "closed", "block")).toBe(false);
    expect(() => assertTransition("open", "verified", "warn")).toThrow(IssueTransitionError);
  });

  it("refuses a no-op move with a clear message", () => {
    expect(() => assertTransition("open", "open", "warn")).toThrow(/already/);
  });
});

describe("blocking", () => {
  it("counts block issues until they are closed or rejected", () => {
    expect(isBlockingOpen({ severity: "block", state: "verified" })).toBe(true);
    expect(isBlockingOpen({ severity: "block", state: "closed" })).toBe(false);
    expect(isBlockingOpen({ severity: "block", state: "rejected" })).toBe(false);
    expect(isBlockingOpen({ severity: "warn", state: "open" })).toBe(false);
  });
});

describe("ageing", () => {
  const now = new Date("2026-10-09T10:00:00Z");
  it("is overdue after the due date and due soon inside three days", () => {
    expect(ageing({ state: "open", due_at: "2026-10-08T00:00:00Z" }, now).status).toBe("overdue");
    expect(ageing({ state: "open", due_at: "2026-10-11T00:00:00Z" }, now).status).toBe("due_soon");
    expect(ageing({ state: "open", due_at: "2026-10-30T00:00:00Z" }, now).status).toBe("on_time");
  });
  it("does not blame the entity once it has responded, and settles verified work", () => {
    expect(ageing({ state: "responded", due_at: "2026-10-01T00:00:00Z" }, now).status).toBe("on_time");
    expect(ageing({ state: "verified", due_at: "2026-10-01T00:00:00Z" }, now).status).toBe("settled");
  });
  it("has no clock without a due date or outside the entity states", () => {
    expect(ageing({ state: "open" }, now).status).toBe("no_due_date");
    expect(ageing({ state: "accepted", due_at: "2026-10-01T00:00:00Z" }, now).status).toBe("no_due_date");
  });
  it("offers a default due date", () => {
    expect(defaultDueDate(new Date("2026-10-09T00:00:00Z")).toISOString()).toBe("2026-10-23T00:00:00.000Z");
  });
});

describe("summariseIssues", () => {
  it("counts states, blockers, overdue and awaiting-verifier", () => {
    const now = new Date("2026-10-09T10:00:00Z");
    const s = summariseIssues(
      [
        { state: "open", severity: "block", due_at: "2026-10-01T00:00:00Z" },
        { state: "responded", severity: "block" },
        { state: "closed", severity: "block" },
        { state: "suggested", severity: "warn" },
      ],
      now
    );
    expect(s).toMatchObject({ total: 4, blockingOpen: 2, overdue: 1, awaitingVerifier: 1 });
    expect(s.byState.open).toBe(1);
  });
});
