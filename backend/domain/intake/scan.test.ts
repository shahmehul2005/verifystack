import { describe, expect, it } from "vitest";
import { assessScan, readImageDimensions } from "./scan";

function png(w: number, h: number): Uint8Array {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const dv = new DataView(b.buffer);
  dv.setUint32(8, 13);
  b.set([0x49, 0x48, 0x44, 0x52], 12);
  dv.setUint32(16, w);
  dv.setUint32(20, h);
  return b;
}

function jpeg(w: number, h: number): Uint8Array {
  // SOI, APP0 (len 16), SOF0 (len 17)
  const b = new Uint8Array(2 + 18 + 19);
  b.set([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
  const o = 2 + 18;
  b.set([0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 0xff, w >> 8, w & 0xff, 0x03], o);
  return b;
}

describe("readImageDimensions", () => {
  it("reads PNG and JPEG headers", () => {
    expect(readImageDimensions(png(2480, 3508))).toEqual({ format: "png", width: 2480, height: 3508 });
    expect(readImageDimensions(jpeg(1600, 2200))).toEqual({ format: "jpeg", width: 1600, height: 2200 });
  });

  it("recognises PDF and unknown without dimensions", () => {
    expect(readImageDimensions(new TextEncoder().encode("%PDF-1.7"))).toMatchObject({ format: "pdf", width: null });
    expect(readImageDimensions(new Uint8Array([1, 2, 3, 4, 5]))).toMatchObject({ format: "unknown" });
  });

  it("does not run off the end of a truncated JPEG", () => {
    expect(readImageDimensions(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0xff, 0xff, 0, 0, 0, 0, 0, 0]))).toMatchObject({
      format: "jpeg",
      width: null,
    });
  });
});

describe("assessScan", () => {
  it("passes an A4 scan at 300 dpi", () => {
    expect(assessScan(png(2480, 3508)).quality).toBe("ok");
  });
  it("warns on a middling scan and rejects a thumbnail", () => {
    expect(assessScan(png(1000, 1100)).quality).toBe("warn");
    const poor = assessScan(png(500, 700));
    expect(poor.quality).toBe("poor");
    expect(poor.issues[0]).toMatch(/rescan/);
  });
  it("flags a narrow strip", () => {
    expect(assessScan(png(600, 3000)).quality).not.toBe("poor");
    expect(assessScan(png(1300, 5600)).issues.join(" ")).toMatch(/strip/);
  });
  it("is unknown for a PDF, which is judged per page at extraction", () => {
    expect(assessScan(new TextEncoder().encode("%PDF-1.7")).quality).toBe("unknown");
  });
});
