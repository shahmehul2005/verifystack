import { describe, expect, it } from "vitest";
import { appUrlHost, isCrossSiteWrite } from "./sameOrigin";

const base = {
  method: "POST",
  pathname: "/api/facts",
  origin: "https://app.verifystack.in",
  host: "app.verifystack.in",
  secFetchSite: "same-origin",
};

describe("isCrossSiteWrite", () => {
  it("passes same-origin writes and all reads", () => {
    expect(isCrossSiteWrite(base)).toBe(false);
    expect(isCrossSiteWrite({ ...base, method: "GET", origin: "https://evil.example" })).toBe(false);
  });

  it("refuses a write from another origin", () => {
    expect(isCrossSiteWrite({ ...base, origin: "https://evil.example", secFetchSite: null })).toBe(true);
    expect(isCrossSiteWrite({ ...base, secFetchSite: "cross-site" })).toBe(true);
    expect(isCrossSiteWrite({ ...base, origin: "null" })).toBe(true);
  });

  it("passes requests with no Origin (scripts) and the Inngest endpoint", () => {
    expect(isCrossSiteWrite({ ...base, origin: null, secFetchSite: null })).toBe(false);
    expect(
      isCrossSiteWrite({ ...base, pathname: "/api/inngest", origin: "https://inn.gs", secFetchSite: "cross-site" })
    ).toBe(false);
  });

  it("accepts the configured APP_URL host behind a proxy", () => {
    expect(
      isCrossSiteWrite({ ...base, host: "internal:3000", allowedHosts: ["app.verifystack.in"] })
    ).toBe(false);
    expect(appUrlHost({ APP_URL: "https://app.verifystack.in/" })).toBe("app.verifystack.in");
    expect(appUrlHost({})).toBeNull();
  });
});
