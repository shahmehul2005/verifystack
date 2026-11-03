import { describe, expect, it } from "vitest";
import { numbersIn, pdfItemToPageItem, readBox, textInRegion, type PageTextItem } from "./boxText";

const item = (text: string, x: number, y: number, width = 0.1, height = 0.02): PageTextItem => ({ text, x, y, width, height });

describe("numbersIn", () => {
  it("finds a figure with western and Indian grouping and a decimal", () => {
    expect(numbersIn("Quantity 18,247 MT").map((n) => n.value)).toEqual([18247]);
    expect(numbersIn("Total 1,23,456.78 kWh").map((n) => n.value)).toEqual([123456.78]);
    expect(numbersIn("GCV 4200").map((n) => n.value)).toEqual([4200]);
    expect(numbersIn("-12.5").map((n) => n.value)).toEqual([-12.5]);
  });

  it("does not take digits stuck to letters or a malformed group", () => {
    expect(numbersIn("Grade A12 sample")).toEqual([]);
    expect(numbersIn("1,2345")).toEqual([]);
  });

  it("lists each different figure once, and nothing when there is none", () => {
    expect(numbersIn("100 and 100 and 250").map((n) => n.value)).toEqual([100, 250]);
    expect(numbersIn("no figures here")).toEqual([]);
  });

  it("ignores a trailing comma", () => {
    expect(numbersIn("5,000, then").map((n) => n.value)).toEqual([5000]);
  });
});

describe("textInRegion", () => {
  const region = { x: 0.1, y: 0.1, width: 0.5, height: 0.1 };

  it("takes items inside the box, left to right, and leaves out the rest", () => {
    const items = [item("MT", 0.35, 0.12), item("Quantity", 0.1, 0.12), item("18,247", 0.22, 0.12), item("Elsewhere", 0.1, 0.5)];
    expect(textInRegion(items, region)).toBe("Quantity 18,247 MT");
  });

  it("takes an item that is mostly inside and leaves one that only touches", () => {
    expect(textInRegion([item("mostly", 0.54, 0.12, 0.1)], region)).toBe("mostly");
    expect(textInRegion([item("edge", 0.59, 0.12, 0.1)], region)).toBe("");
  });

  it("reads lines top to bottom", () => {
    const items = [item("second", 0.1, 0.17), item("first", 0.1, 0.11)];
    expect(textInRegion(items, region)).toBe("first second");
  });
});

describe("readBox", () => {
  it("returns the text and the figures in it", () => {
    const r = readBox([item("Clinker", 0.1, 0.12), item("12,500", 0.25, 0.12)], { x: 0.05, y: 0.1, width: 0.4, height: 0.06 });
    expect(r.text).toBe("Clinker 12,500");
    expect(r.numbers).toEqual([{ text: "12,500", value: 12500 }]);
  });
});

describe("pdfItemToPageItem", () => {
  // An upright page 600 by 800 at scale 1: pdf.js flips y, so the viewport matrix is [1,0,0,-1,0,800].
  const viewport = [1, 0, 0, -1, 0, 800];

  it("puts an upright item on the page from its top-left", () => {
    // 12 pt text with its baseline at (60, 700) in PDF space, 120 wide.
    const p = pdfItemToPageItem("Total", [12, 0, 0, 12, 60, 700], 120, viewport, 600, 800)!;
    expect(p.x).toBeCloseTo(60 / 600);
    expect(p.width).toBeCloseTo(120 / 600);
    expect(p.y).toBeCloseTo((800 - 700 - 12) / 800);
    expect(p.height).toBeCloseTo(12 / 800);
  });

  it("scales with the viewport", () => {
    const p = pdfItemToPageItem("Total", [12, 0, 0, 12, 60, 700], 120, [2, 0, 0, -2, 0, 1600], 1200, 1600)!;
    expect(p.x).toBeCloseTo(60 / 600);
    expect(p.width).toBeCloseTo(120 / 600);
  });

  it("refuses a page with no size", () => {
    expect(pdfItemToPageItem("x", [1, 0, 0, 1, 0, 0], 1, viewport, 0, 0)).toBeNull();
  });
});
