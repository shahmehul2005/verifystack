import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { crc32, isSafeZipPath, openZip, writeZip, ZipError } from "./zip";

describe("crc32", () => {
  it("matches the standard check value", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });
});

describe("writeZip / openZip", () => {
  it("round-trips files and is deterministic", () => {
    const files = [
      { name: "manifest.json", data: '{"a":1}' },
      { name: "docs/bill.txt", data: "Électricité 1,234 kWh" },
    ];
    const a = writeZip(files);
    const b = writeZip(files);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
    const zip = openZip(a);
    expect(zip.entries.map((e) => e.name)).toEqual(["manifest.json", "docs/bill.txt"]);
    expect(zip.readText("docs/bill.txt")).toBe("Électricité 1,234 kWh");
  });

  it("reads deflate entries produced by other tools", () => {
    const payload = Buffer.from("x".repeat(5000));
    const comp = deflateRawSync(payload);
    // Hand-build a one-entry deflate archive by patching a stored one.
    const stored = Buffer.from(writeZip([{ name: "a.txt", data: payload }]));
    const nameLen = 5;
    const localEnd = 30 + nameLen;
    const cenStart = localEnd + payload.length;
    const eocdStart = stored.length - 22;
    const cen = Buffer.from(stored.subarray(cenStart, eocdStart));
    const local = Buffer.from(stored.subarray(0, localEnd));
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(comp.length, 18);
    cen.writeUInt16LE(8, 10);
    cen.writeUInt32LE(comp.length, 20);
    const eocd = Buffer.from(stored.subarray(eocdStart));
    eocd.writeUInt32LE(localEnd + comp.length, 16);
    const zip = openZip(new Uint8Array(Buffer.concat([local, comp, cen, eocd])));
    expect(zip.read("a.txt").length).toBe(5000);
  });

  it("refuses unsafe paths when writing and reading", () => {
    expect(() => writeZip([{ name: "../x", data: "1" }])).toThrow(ZipError);
    expect(isSafeZipPath("a/b.txt")).toBe(true);
    expect(isSafeZipPath("/etc/passwd")).toBe(false);
    expect(isSafeZipPath("a\\b")).toBe(false);
    expect(isSafeZipPath("C:/x")).toBe(false);
  });

  it("refuses garbage, truncation and oversized archives", () => {
    expect(() => openZip(new Uint8Array(100))).toThrow(ZipError);
    const good = writeZip([{ name: "a.txt", data: "hello" }]);
    expect(() => openZip(good.subarray(0, good.length - 5))).toThrow(ZipError);
    expect(() => openZip(good, { maxEntries: 1, maxEntryBytes: 3, maxTotalBytes: 3 })).toThrow(/limit/);
  });

  it("detects a corrupted entry by checksum", () => {
    const good = Buffer.from(writeZip([{ name: "a.txt", data: "hello world" }]));
    good[30 + 5] = good[30 + 5]! ^ 0xff;
    const zip = openZip(new Uint8Array(good));
    expect(() => zip.read("a.txt")).toThrow(/checksum/);
  });
});
