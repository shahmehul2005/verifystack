/**
 * Third-party evidence pack importer (DFD 2.6).
 *
 * An evidence pack is a ZIP holding a `manifest.json` and the files it lists.
 * This is the one interchange format the product defines and reads: it is also
 * what the submission package writes, so a package can be re-imported to check
 * it round-trips.
 *
 * Adapters for other systems (an ERP export, a client portal bundle, a
 * monitoring vendor's report) need a real sample to be written against, and
 * none has been provided. The adapter registry is the extension point; an
 * unrecognised archive is refused with the list of formats that are supported
 * rather than guessed at.
 *
 * Trust: nothing in the manifest is believed. Every listed file is hashed here
 * and compared with the digest the manifest claims; a mismatch, a missing file
 * or an unsafe path rejects the whole pack. Declared values are carried through
 * as declarations only (they feed the declared-vs-extracted comparison); they
 * never become facts.
 */

import { z } from "zod";
import { isSafeZipPath, openZip, ZipError, type ZipArchive } from "../archive/zip";
import { sha256Hex } from "../canonical";

export const EVIDENCE_PACK_FORMAT = "verifystack-evidence-pack";
export const EVIDENCE_PACK_VERSION = 1;
export const MAX_PACK_FILES = 500;

export class EvidencePackError extends Error {
  constructor(
    message: string,
    readonly problems: string[] = []
  ) {
    super(message);
    this.name = "EvidencePackError";
  }
}

const Sha256 = z.string().regex(/^[0-9a-f]{64}$/, "sha256 must be 64 lowercase hex characters");

export const ManifestSchema = z.object({
  format: z.literal(EVIDENCE_PACK_FORMAT),
  version: z.literal(EVIDENCE_PACK_VERSION),
  createdAt: z.string().max(40).optional(),
  source: z
    .object({ system: z.string().max(120), name: z.string().max(200).optional() })
    .optional(),
  entity: z
    .object({
      name: z.string().max(200),
      plant: z.string().max(200).optional(),
      period: z.string().max(40).optional(),
    })
    .optional(),
  files: z
    .array(
      z.object({
        path: z.string().min(1).max(300),
        sha256: Sha256,
        mediaType: z.string().max(120).optional(),
        docType: z.string().max(80).optional(),
        title: z.string().max(200).optional(),
      })
    )
    .max(MAX_PACK_FILES),
  declared: z
    .array(
      z.object({
        fieldPath: z.string().min(1).max(200),
        value: z.union([z.number(), z.string().max(500), z.boolean(), z.null()]),
        unit: z.string().max(30).nullable().optional(),
        note: z.string().max(300).optional(),
      })
    )
    .max(2_000)
    .default([]),
});

export type EvidencePackManifest = z.infer<typeof ManifestSchema>;

export interface ImportedFile {
  path: string;
  name: string;
  bytes: Uint8Array;
  sha256: string;
  mediaType: string | null;
  docType: string | null;
  title: string | null;
}

export interface ImportedPack {
  adapter: string;
  manifest: EvidencePackManifest;
  files: ImportedFile[];
  /** Entries in the archive the manifest does not list. Ignored, but reported. */
  unlisted: string[];
}

export interface PackAdapter {
  id: string;
  label: string;
  detect(zip: ZipArchive): boolean;
  read(zip: ZipArchive): ImportedPack;
}

const nativeAdapter: PackAdapter = {
  id: "verifystack-evidence-pack-v1",
  label: "VerifyStack evidence pack v1",
  detect: (zip) => zip.has("manifest.json"),
  read(zip) {
    let raw: unknown;
    try {
      raw = JSON.parse(zip.readText("manifest.json"));
    } catch {
      throw new EvidencePackError("manifest.json is not valid JSON.");
    }
    const parsed = ManifestSchema.safeParse(raw);
    if (!parsed.success) {
      throw new EvidencePackError(
        "manifest.json does not match the evidence pack format.",
        parsed.error.issues.slice(0, 8).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      );
    }
    const manifest = parsed.data;

    const problems: string[] = [];
    const seen = new Set<string>();
    const files: ImportedFile[] = [];
    for (const f of manifest.files) {
      if (!isSafeZipPath(f.path)) {
        problems.push(`${f.path}: unsafe path.`);
        continue;
      }
      if (seen.has(f.path)) {
        problems.push(`${f.path}: listed twice.`);
        continue;
      }
      seen.add(f.path);
      if (!zip.has(f.path)) {
        problems.push(`${f.path}: listed in the manifest but missing from the archive.`);
        continue;
      }
      let bytes: Uint8Array;
      try {
        bytes = zip.read(f.path);
      } catch (e) {
        problems.push(`${f.path}: ${e instanceof ZipError ? e.message : "unreadable"}.`);
        continue;
      }
      const actual = sha256Hex(bytes);
      if (actual !== f.sha256) {
        problems.push(`${f.path}: content does not match its recorded sha256.`);
        continue;
      }
      files.push({
        path: f.path,
        name: f.path.split("/").pop() ?? f.path,
        bytes,
        sha256: actual,
        mediaType: f.mediaType ?? null,
        docType: f.docType ?? null,
        title: f.title ?? null,
      });
    }
    if (problems.length > 0) {
      throw new EvidencePackError("The evidence pack failed verification and nothing was imported.", problems);
    }
    const unlisted = zip.entries
      .filter((e) => !e.isDirectory && e.name !== "manifest.json" && !seen.has(e.name))
      .map((e) => e.name);
    return { adapter: this.id, manifest, files, unlisted };
  },
};

export const PACK_ADAPTERS: PackAdapter[] = [nativeAdapter];

export function importEvidencePack(data: Uint8Array): ImportedPack {
  let zip: ZipArchive;
  try {
    zip = openZip(data);
  } catch (e) {
    if (e instanceof ZipError) throw new EvidencePackError(`Not a readable archive: ${e.message}`);
    throw e;
  }
  const adapter = PACK_ADAPTERS.find((a) => a.detect(zip));
  if (!adapter) {
    throw new EvidencePackError(
      `This archive is not in a supported format. Supported: ${PACK_ADAPTERS.map((a) => a.label).join(", ")}. Other systems need an adapter written against a real sample export.`
    );
  }
  return adapter.read(zip);
}
