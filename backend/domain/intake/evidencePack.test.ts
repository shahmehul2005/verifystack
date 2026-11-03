import { describe, expect, it } from "vitest";
import { writeZip } from "../archive/zip";
import { sha256Hex } from "../canonical";
import { EvidencePackError, importEvidencePack } from "./evidencePack";

function pack(overrides: { manifest?: object; files?: Array<{ name: string; data: string }> } = {}) {
  const files = overrides.files ?? [
    { name: "bills/jan.pdf", data: "January bill" },
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

describe("importEvidencePack with a manifest", () => {
  it("imports a verified pack with its declarations, every file marked verified", () => {
    const r = importEvidencePack(pack());
    expect(r.adapter).toBe("verifystack-evidence-pack-v1");
    expect(r.files.map((f) => f.name)).toEqual(["jan.pdf", "prod.csv"]);
    expect(r.files.every((f) => f.integrity.status === "verified")).toBe(true);
    expect(r.files[0]!.sha256).toBe(sha256Hex("January bill"));
    expect(r.manifest?.declared).toEqual([{ fieldPath: "production", value: 18250, unit: "t" }]);
    expect(r.unlisted).toEqual([]);
    expect(r.mismatches).toEqual([]);
  });

  it("imports a file whose hash does not match, flags it, and reports the mismatch", () => {
    const bad = pack({
      manifest: { files: [{ path: "a.pdf", sha256: "0".repeat(64) }] },
      files: [{ name: "a.pdf", data: "tampered" }],
    });
    const r = importEvidencePack(bad);
    expect(r.files).toHaveLength(1);
    expect(r.files[0]!.integrity).toEqual({ status: "mismatch", expectedSha256: "0".repeat(64) });
    expect(r.files[0]!.sha256).toBe(sha256Hex("tampered"));
    expect(r.mismatches).toEqual([
      { path: "a.pdf", expectedSha256: "0".repeat(64), actualSha256: sha256Hex("tampered") },
    ]);
  });

  it("skips a listed file that is missing, an unsafe path and a duplicate, and imports the rest", () => {
    const h = sha256Hex("x");
    const r = importEvidencePack(
      pack({
        manifest: {
          files: [
            { path: "gone.pdf", sha256: "a".repeat(64) },
            { path: "../x.pdf", sha256: h },
            { path: "a.pdf", sha256: h },
            { path: "a.pdf", sha256: h },
          ],
        },
        files: [{ name: "a.pdf", data: "x" }],
      })
    );
    expect(r.files.map((f) => f.path)).toEqual(["a.pdf"]);
    expect(r.skipped.map((s) => s.path)).toEqual(["gone.pdf", "../x.pdf", "a.pdf"]);
    expect(r.skipped[0]!.reason).toMatch(/missing from the archive/);
  });

  it("imports supported files the manifest does not list, flagged not_listed", () => {
    const data = writeZip([
      { name: "manifest.json", data: JSON.stringify({ format: "verifystack-evidence-pack", version: 1, files: [{ path: "a.pdf", sha256: sha256Hex("x") }] }) },
      { name: "a.pdf", data: "x" },
      { name: "extra.xlsx", data: "y" },
    ]);
    const r = importEvidencePack(data);
    expect(r.unlisted).toEqual(["extra.xlsx"]);
    expect(r.files.find((f) => f.path === "extra.xlsx")!.integrity).toEqual({ status: "not_listed" });
  });

  it("skips unlisted entries that are not documents", () => {
    const data = writeZip([
      { name: "manifest.json", data: JSON.stringify({ format: "verifystack-evidence-pack", version: 1, files: [{ path: "a.pdf", sha256: sha256Hex("x") }] }) },
      { name: "a.pdf", data: "x" },
      { name: "stowaway.exe", data: "MZ" },
    ]);
    const r = importEvidencePack(data);
    expect(r.files.map((f) => f.path)).toEqual(["a.pdf"]);
    expect(r.skipped).toEqual([{ path: "stowaway.exe", reason: "Not in the manifest, and not a PDF, image, Excel or CSV file." }]);
  });

  it("still imports listed files of any type, so a submission package round-trips", () => {
    const r = importEvidencePack(pack({ files: [{ name: "README.txt", data: "hello" }] }));
    expect(r.files.map((f) => f.path)).toEqual(["README.txt"]);
    expect(r.files[0]!.integrity.status).toBe("verified");
  });
});

describe("importEvidencePack without a usable manifest (plain folder)", () => {
  it("imports a plant folder of PDFs and workbooks, hashing each on receipt", () => {
    const r = importEvidencePack(
      writeZip([
        { name: "01_scada.xlsx", data: "x" },
        { name: "16_form1.pdf", data: "y" },
        { name: "notes/readme.txt", data: "ignored" },
      ])
    );
    expect(r.adapter).toBe("plain-folder");
    expect(r.manifest).toBeNull();
    expect(r.files.map((f) => f.path)).toEqual(["01_scada.xlsx", "16_form1.pdf"]);
    expect(r.files.every((f) => f.integrity.status === "no_manifest")).toBe(true);
    expect(r.files[1]!.sha256).toBe(sha256Hex("y"));
    expect(r.skipped).toEqual([{ path: "notes/readme.txt", reason: "Not a PDF, image, Excel or CSV file." }]);
    expect(r.warnings).toEqual([]);
  });

  it("uses the file name without its folder for files in sub-folders", () => {
    const r = importEvidencePack(writeZip([{ name: "bills/2023/jan.pdf", data: "z" }]));
    expect(r.files[0]).toMatchObject({ path: "bills/2023/jan.pdf", name: "jan.pdf" });
  });

  it("imports the files and warns when the manifest is unreadable", () => {
    const r = importEvidencePack(
      writeZip([
        { name: "manifest.json", data: "{not json" },
        { name: "a.pdf", data: "x" },
      ])
    );
    expect(r.adapter).toBe("plain-folder");
    expect(r.files.map((f) => f.path)).toEqual(["a.pdf"]);
    expect(r.warnings[0]).toMatch(/manifest\.json was ignored \(manifest\.json is not valid JSON/);
  });

  it("warns when the manifest has the wrong format and imports without it", () => {
    const r = importEvidencePack(
      writeZip([
        { name: "manifest.json", data: JSON.stringify({ format: "other", version: 1, files: [] }) },
        { name: "a.pdf", data: "x" },
      ])
    );
    expect(r.adapter).toBe("plain-folder");
    expect(r.warnings[0]).toMatch(/does not match the evidence pack format/);
  });

  it("refuses an archive with nothing importable, and says why", () => {
    expect(() => importEvidencePack(writeZip([{ name: "x.txt", data: "a" }]))).toThrow(EvidencePackError);
    expect(() => importEvidencePack(writeZip([{ name: "x.txt", data: "a" }]))).toThrow(/no PDF, image, Excel or CSV/);
  });

  it("refuses bytes that are not a ZIP", () => {
    expect(() => importEvidencePack(new Uint8Array(10))).toThrow(/Not a readable archive/);
  });
});
