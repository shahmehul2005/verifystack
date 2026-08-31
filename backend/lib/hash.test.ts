import { describe, expect, it } from "vitest";
import { sha256Bytes, evidenceObjectKey } from "./hash";

describe("content-addressed hash / dedupe", () => {
  it("is stable for the same bytes", () => {
    const a = sha256Bytes(Buffer.from("invoice-bytes"));
    const b = sha256Bytes(Buffer.from("invoice-bytes"));
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
    expect(evidenceObjectKey(a)).toBe(a);
  });

  it("differs when any byte changes", () => {
    const a = sha256Bytes(Buffer.from("invoice-bytes"));
    const b = sha256Bytes(Buffer.from("invoice-bytez"));
    expect(a).not.toBe(b);
  });

  it("treats ArrayBuffer and Uint8Array identically", () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    expect(sha256Bytes(bytes)).toBe(sha256Bytes(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + 4)));
  });
});
