import { describe, expect, it } from "vitest";
import { chooseRoute } from "./digital";

describe("chooseRoute", () => {
  it("sends images to vision", () => {
    expect(chooseRoute(10_000, "image/png")).toBe("vision");
  });

  it("sends a text-rich PDF to the digital route and a scan to vision", () => {
    expect(chooseRoute(500, "application/pdf")).toBe("digital");
    expect(chooseRoute(20, "application/pdf")).toBe("vision");
  });
});
