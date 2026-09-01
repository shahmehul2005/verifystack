import { describe, expect, it } from "vitest";
import { passwordIssue, publicAuthMessage, safeNextPath } from "./redirect";

describe("safeNextPath", () => {
  it("falls back when empty or absolute", () => {
    expect(safeNextPath(null)).toBe("/engagements");
    expect(safeNextPath("https://evil.example/phish")).toBe("/engagements");
    expect(safeNextPath("//evil.example")).toBe("/engagements");
    expect(safeNextPath("/\\evil")).toBe("/engagements");
  });

  it("rejects auth loops and keeps in-app paths", () => {
    expect(safeNextPath("/login")).toBe("/engagements");
    expect(safeNextPath("/auth/callback")).toBe("/engagements");
    expect(safeNextPath("/engagements/abc")).toBe("/engagements/abc");
    expect(safeNextPath("/update-password")).toBe("/update-password");
    expect(safeNextPath("/review-queue?tab=open")).toBe("/review-queue?tab=open");
  });
});

describe("passwordIssue", () => {
  it("enforces length and confirmation", () => {
    expect(passwordIssue("short")).toMatch(/at least 8/);
    expect(passwordIssue("long-enough", "other")).toMatch(/match/);
    expect(passwordIssue("long-enough", "long-enough")).toBeNull();
  });
});

describe("publicAuthMessage", () => {
  it("does not echo provider error text", () => {
    expect(publicAuthMessage("access_denied")).toMatch(/cancelled/);
    expect(publicAuthMessage("no_peanuts_for_you")).toMatch(/Try again/);
  });
});
