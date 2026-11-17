import { describe, expect, it } from "vitest";
import { fiscalStartYear, fiscalYearWindow, getFiscalMonths } from "./months";

describe("fiscalStartYear", () => {
  it.each([
    ["FY2025-26", 2025],
    ["2025-26", 2025],
    ["FY 2025-2026", 2025],
    ["FY25-26", 2025],
    ["fy25-26", 2025],
    ["FY99-00", 2099],
  ])("parses %s", (label, year) => {
    expect(fiscalStartYear(label)).toBe(year);
  });

  it.each([
    "",
    "garbage",
    "FY2025-27",
    "FY25-27",
    "2025",
    "FY25",
  ])("returns null for %j", (label) => {
    expect(fiscalStartYear(label)).toBeNull();
  });

  it("returns null for null and undefined", () => {
    expect(fiscalStartYear(null)).toBeNull();
    expect(fiscalStartYear(undefined)).toBeNull();
  });
});

describe("fiscalYearWindow", () => {
  it.each(["FY2025-26", "2025-26", "FY 2025-2026", "FY25-26"])(
    "gives 1 Apr to 31 Mar for %s",
    (label) => {
      expect(fiscalYearWindow(label)).toEqual({ start: "2025-04-01", end: "2026-03-31" });
    },
  );

  it("returns null for invalid labels", () => {
    expect(fiscalYearWindow("nonsense")).toBeNull();
    expect(fiscalYearWindow("FY2025-30")).toBeNull();
    expect(fiscalYearWindow(null)).toBeNull();
    expect(fiscalYearWindow(undefined)).toBeNull();
  });

  it("ends on 31 Mar regardless of a leap-year February", () => {
    // FY2023-24 contains 29 Feb 2024; FY2019-20 ends in leap year 2020.
    expect(fiscalYearWindow("FY2023-24")).toEqual({ start: "2023-04-01", end: "2024-03-31" });
    expect(fiscalYearWindow("FY2019-20")).toEqual({ start: "2019-04-01", end: "2020-03-31" });
  });
});

describe("getFiscalMonths", () => {
  it("falls back to 2023-24 for an unparseable label", () => {
    const months = getFiscalMonths("bad");
    expect(months[0]!.startDate).toBe("2023-04-01");
    expect(months[11]!.endDate).toBe("2024-03-31");
  });

  it("uses the parsed year, including the short form", () => {
    const months = getFiscalMonths("FY25-26");
    expect(months).toHaveLength(12);
    expect(months[0]!.key).toBe("2025-04");
    expect(months[11]!.key).toBe("2026-03");
  });

  it("gives February 29 days in a leap-year end", () => {
    const feb = getFiscalMonths("FY2023-24")[10]!;
    expect(feb.key).toBe("2024-02");
    expect(feb.endDate).toBe("2024-02-29");
    expect(getFiscalMonths("FY2024-25")[10]!.endDate).toBe("2025-02-28");
  });
});
