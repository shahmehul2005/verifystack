import { describe, expect, it } from "vitest";
import { writeZip } from "../archive/zip";
import { sha256Hex } from "../canonical";
import { EvidencePackError, importEvidencePack } from "./evidencePack";

function pack(overrides: { manifest?: object; files?: Array<{ name: string; data: string }> } = {}) {
  const files = overrides.files ?? [
    { name: "bills/jan.txt", data: "January bill" },
    { name: "logs/prod.csv", data: "a,b\n1,2" },
  ];
  const manifest = {
    format: "verifystack-evidence-pack",
    version: 1,
    entity: { name: "Aravalli Cement", period: "FY2024-25" },
    files: files.map((f) => ({ path: f.name, sha256: sha256Hex(f.data), docType: "other" })),
    declared: [{ fieldPath: "production", value: 18250, unit: "t" }],
    ...overrides.manifest,
  };
  return writeZip([{ name: "manifest.json", data: JSON.stringify(manifest) }, ...files]);
}

describe("importEvidencePack", () => {
  it("imports a verified pack with its declarations", () => {
    const r = importEvidencePack(pack());
    expect(r.files.map((f) => f.name)).toEqual(["jan.txt", "prod.csv"]);
    expect(r.files[0]!.sha256).toBe(sha256Hex("January bill"));
    expect(r.manifest.declared).toEqual([{ fieldPath: "production", value: 18250, unit: "t" }]);
    expect(r.unlisted).toEqual([]);
  });

  it("rejects the whole pack when a file's hash does not match", () => {
    const bad = pack({
      manifest: { files: [{ path: "a.txt", sha256: "0".repeat(64) }] },
      files: [{ name: "a.txt", data: "tampered" }],
    });
    try {
      importEvidencePack(bad);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(EvidencePackError);
      expect((e as EvidencePackError).problems[0]).toMatch(/does not match/);
    }
  });

  it("rejects a missing file, an unsafe path and a duplicate listing", () => {
    const missing = pack({ manifest: { files: [{ path: "gone.txt", sha256: "a".repeat(64) }] }, files: [] });
    expect(() => importEvidencePack(missing)).toThrow(EvidencePackError);
    const unsafe = pack({ manifest: { files: [{ path: "../x", sha256: "a".repeat(64) }] }, files: [] });
    expect(() => importEvidencePack(unsafe)).toThrow(/failed verification/);
    const h = sha256Hex("x");
    const dup = pack({
      manifest: { files: [{ path: "a.txt", sha256: h }, { path: "a.txt", sha256: h }] },
      files: [{ name: "a.txt", data: "x" }],
    });
    expect(() => importEvidencePack(dup)).toThrow(/failed verification/);
  });

  it("reports unlisted entries instead of importing them", () => {
    const files = [{ name: "a.txt", data: "x" }];
    const data = writeZip([
      { name: "manifest.json", data: JSON.stringify({ format: "verifystack-evidence-pack", version: 1, files: [{ path: "a.txt", sha256: sha256Hex("x") }] }) },
      ...files,
      { name: "stowaway.exe", data: "MZ" },
    ]);
    const r = importEvidencePack(data);
    expect(r.files.length).toBe(1);
    expect(r.unlisted).toEqual(["stowaway.exe"]);
  });

  it("refuses unknown formats, bad manifests and non-archives with a reason", () => {
    expect(() => importEvidencePack(writeZip([{ name: "x.csv", data: "a" }]))).toThrow(/not in a supported format/);
    expect(() => importEvidencePack(writeZip([{ name: "manifest.json", data: "{not json" }]))).toThrow(/valid JSON/);
    expect(() =>
      importEvidencePack(writeZip([{ name: "manifest.json", data: JSON.stringify({ format: "other", version: 1, files: [] }) }]))
    ).toThrow(/does not match/);
    expect(() => importEvidencePack(new Uint8Array(10))).toThrow(/Not a readable archive/);
  });
});
