import { describe, expect, it } from "vitest";
import { hasSupabaseAuthCookie } from "./authCookies";

describe("hasSupabaseAuthCookie", () => {
  it("is false when no auth cookie is present", () => {
    expect(hasSupabaseAuthCookie([])).toBe(false);
    expect(hasSupabaseAuthCookie([{ name: "other" }])).toBe(false);
  });

  it("detects the standard and chunked Supabase auth cookie names", () => {
    expect(hasSupabaseAuthCookie([{ name: "sb-abcd-auth-token" }])).toBe(true);
    expect(hasSupabaseAuthCookie([{ name: "sb-abcd-auth-token.0" }, { name: "sb-abcd-auth-token.1" }])).toBe(
      true
    );
  });
});
