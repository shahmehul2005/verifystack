import { describe, expect, it } from "vitest";
import { MIN_SIDE, describeRegion, isUsableRegion, parseRegion, regionFromDrag } from "./snip";

const PAGE = { width: 500, height: 700 };

describe("regionFromDrag", () => {
  it("turns a drag into a region of the page, whichever corner it starts from", () => {
    const down = regionFromDrag({ x: 50, y: 70 }, { x: 250, y: 140 }, PAGE);
    const up = regionFromDrag({ x: 250, y: 140 }, { x: 50, y: 70 }, PAGE);
    expect(down).toEqual({ x: 0.1, y: 0.1, width: 0.4, height: 0.1 });
    expect(up).toEqual(down);
  });

  it("holds a drag that leaves the page to the page edge", () => {
    expect(regionFromDrag({ x: 400, y: 600 }, { x: 900, y: 900 }, PAGE)).toEqual({ x: 0.8, y: 0.8571, width: 0.2, height: 0.1429 });
    expect(regionFromDrag({ x: -40, y: -40 }, { x: 50, y: 70 }, PAGE)).toEqual({ x: 0, y: 0, width: 0.1, height: 0.1 });
  });

  it("is null for a click or a sliver", () => {
    expect(regionFromDrag({ x: 100, y: 100 }, { x: 100, y: 100 }, PAGE)).toBeNull();
    expect(regionFromDrag({ x: 100, y: 100 }, { x: 101, y: 300 }, PAGE)).toBeNull();
  });

  it("is null when the page has no size yet", () => {
    expect(regionFromDrag({ x: 0, y: 0 }, { x: 10, y: 10 }, { width: 0, height: 0 })).toBeNull();
  });
});

describe("parseRegion and isUsableRegion", () => {
  it("accepts a region on the page", () => {
    expect(parseRegion({ x: 0.1, y: 0.2, width: 0.3, height: 0.05 })).toEqual({ x: 0.1, y: 0.2, width: 0.3, height: 0.05 });
    expect(isUsableRegion({ x: 0, y: 0, width: 1, height: 1 })).toBe(true);
  });

  it("refuses a region that runs off the page, has no area, or is not numbers", () => {
    expect(parseRegion({ x: 0.8, y: 0.1, width: 0.3, height: 0.1 })).toBeNull();
    expect(parseRegion({ x: -0.1, y: 0.1, width: 0.3, height: 0.1 })).toBeNull();
    expect(parseRegion({ x: 0.1, y: 0.1, width: 0, height: 0.1 })).toBeNull();
    expect(parseRegion({ x: 0.1, y: 0.1, width: MIN_SIDE / 2, height: 0.1 })).toBeNull();
    expect(parseRegion({ x: "a", y: 0, width: 1, height: 1 })).toBeNull();
    expect(parseRegion(null)).toBeNull();
    expect(parseRegion("box")).toBeNull();
  });
});

describe("describeRegion", () => {
  it("says where on the page and how big", () => {
    expect(describeRegion({ x: 0.1, y: 0.1, width: 0.2, height: 0.05 })).toBe("top left of the page, 20% wide and 5% high");
    expect(describeRegion({ x: 0.4, y: 0.45, width: 0.2, height: 0.1 })).toBe("centre of the page, 20% wide and 10% high");
    expect(describeRegion({ x: 0.7, y: 0.8, width: 0.25, height: 0.1 })).toBe("bottom right of the page, 25% wide and 10% high");
  });
});
