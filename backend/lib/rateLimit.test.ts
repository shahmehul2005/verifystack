import { describe, expect, it } from "vitest";
import { createRateLimiter } from "./rateLimit";

describe("createRateLimiter", () => {
  it("allows up to the limit inside one window, then refuses", () => {
    const hit = createRateLimiter();
    const t0 = 1_000_000;
    expect(hit("k", 2, 60_000, t0).ok).toBe(true);
    expect(hit("k", 2, 60_000, t0 + 1).ok).toBe(true);
    const third = hit("k", 2, 60_000, t0 + 2);
    expect(third.ok).toBe(false);
    expect(third.retryAfterSec).toBe(60);
  });

  it("opens a fresh window once the old one expires", () => {
    const hit = createRateLimiter();
    const t0 = 1_000_000;
    hit("k", 1, 1_000, t0);
    expect(hit("k", 1, 1_000, t0 + 500).ok).toBe(false);
    expect(hit("k", 1, 1_000, t0 + 1_000).ok).toBe(true);
  });

  it("counts keys independently", () => {
    const hit = createRateLimiter();
    expect(hit("a", 1, 1_000, 0).ok).toBe(true);
    expect(hit("b", 1, 1_000, 0).ok).toBe(true);
    expect(hit("a", 1, 1_000, 1).ok).toBe(false);
  });
});
