/**
 * Evidence package importer (DFD 2.6), relaxed for manual auditor uploads.
 *
 * A package is a ZIP. Two shapes are accepted:
 *
 * 1. A VerifyStack evidence pack: a `manifest.json` in the format below, listing
 *    each file with its SHA-256. The manifest is optional for uploading, but
 *    when it is present its hashes are checked against the bytes actually
 *    received. A mismatch does NOT block the import (spec: manifests must not
 *    gate manual uploads). The file is imported, marked `mismatch`, and the
 *    mismatch is returned to the caller and written to the audit log.
 *
 * 2. A plain folder: any ZIP without a usable manifest. Each supported file
 *    (PDF, PNG, JPEG, WebP, XLSX, CSV) is imported as it is. Hashes are computed
 *    here, on receipt, for storage and tamper evidence. Nothing is required from
 *    the client.
 *
 * Files listed by a manifest are imported whatever their extension, so a
 * submission package still round-trips. Unlisted entries are imported only when
 * they are supported document types; anything else is reported as skipped.
 *
 * Declared values in a manifest are declarations only. They feed the
 * declared-versus-extracted comparison and never become facts.
 */

import { z } from "zod";
import { isSafeZipPath, openZip, ZipError, type ZipArchive } from "../archive/zip";
import { sha256Hex } from "../canonical";

export const EVIDENCE_PACK_FORMAT = "verifystack-evidence-pack";
export const EVIDENCE_PACK_VERSION = 1;
export const MAX_PACK_FILES = 500;

/** Extensions a plain folder may contain. The ingest step still checks the bytes. */
const SUPPORTED_ENTRY = /\.(pdf|png|jpe?g|webp|xlsx|csv)$/i;

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

/**
 * What the importer knows about one file's integrity.
 * - verified:  listed in the manifest and the bytes match its hash
 * - mismatch:  listed, and the bytes do NOT match. Imported, flagged, audited.
 * - not_listed: a supported file the manifest does not mention
 * - no_manifest: plain folder; the hash here is the only one there is
 */
export type FileIntegrity =
  | { status: "verified" }
  | { status: "mismatch"; expectedSha256: string }
  | { status: "not_listed" }
  | { status: "no_manifest" };

export interface ImportedFile {
  path: string;
  name: string;
  bytes: Uint8Array;
  sha256: string;
  mediaType: string | null;
  docType: string | null;
  title: string | null;
  integrity: FileIntegrity;
}

export interface ImportedPack {
  /** "verifystack-evidence-pack-v1" when a manifest was used, otherwise "plain-folder". */
  adapter: string;
  /** Null for a plain folder. */
  manifest: EvidencePackManifest | null;
  files: ImportedFile[];
  /** Entries that were not imported, with the reason. */
  skipped: { path: string; reason: string }[];
  /** Supported files the manifest does not list. They are imported, flagged `not_listed`. */
  unlisted: string[];
  /** Listed files whose bytes do not match. They are imported, flagged `mismatch`. */
  mismatches: { path: string; expectedSha256: string; actualSha256: string }[];
  /** Anything the caller should show the auditor, such as an unreadable manifest. */
  warnings: string[];
}

export const PACK_ADAPTER_ID = "verifystack-evidence-pack-v1";
export const PLAIN_FOLDER_ID = "plain-folder";

function parseManifest(text: string): EvidencePackManifest {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
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
  return parsed.data;
}

function plainFolder(zip: ZipArchive, warnings: string[], skipped: ImportedPack["skipped"]): ImportedPack {
  const files: ImportedFile[] = [];
  for (const e of zip.entries) {
    if (e.isDirectory || e.name === "manifest.json") continue;
    if (!SUPPORTED_ENTRY.test(e.name)) {
      skipped.push({ path: e.name, reason: "Not a PDF, image, Excel or CSV file." });
      continue;
    }
    if (files.length >= MAX_PACK_FILES) {
      skipped.push({ path: e.name, reason: `Over the ${MAX_PACK_FILES}-file limit for one archive.` });
      continue;
    }
    let bytes: Uint8Array;
    try {
      bytes = zip.read(e.name);
    } catch (err) {
      skipped.push({ path: e.name, reason: err instanceof ZipError ? err.message : "Could not be read." });
      continue;
    }
    files.push({
      path: e.name,
      name: e.name.split("/").pop() ?? e.name,
      bytes,
      sha256: sha256Hex(bytes),
      mediaType: null,
      docType: null,
      title: null,
      integrity: { status: "no_manifest" },
    });
  }
  if (files.length === 0) {
    throw new EvidencePackError(
      "This archive has no PDF, image, Excel or CSV files to import.",
      skipped.map((s) => `${s.path}: ${s.reason}`)
    );
  }
  return {
    adapter: PLAIN_FOLDER_ID,
    manifest: null,
    files,
    skipped,
    unlisted: [],
    mismatches: [],
    warnings,
  };
}

function manifestPack(
  zip: ZipArchive,
  manifest: EvidencePackManifest,
  warnings: string[]
): ImportedPack {
  const skipped: ImportedPack["skipped"] = [];
  const mismatches: ImportedPack["mismatches"] = [];
  const files: ImportedFile[] = [];
  const seen = new Set<string>();

  for (const f of manifest.files) {
    if (!isSafeZipPath(f.path)) {
      skipped.push({ path: f.path, reason: "Unsafe path in the manifest." });
      continue;
    }
    if (seen.has(f.path)) {
      skipped.push({ path: f.path, reason: "Listed twice in the manifest." });
      continue;
    }
    seen.add(f.path);
    if (!zip.has(f.path)) {
      skipped.push({ path: f.path, reason: "Listed in the manifest but missing from the archive." });
      continue;
    }
    let bytes: Uint8Array;
    try {
      bytes = zip.read(f.path);
    } catch (e) {
      skipped.push({ path: f.path, reason: e instanceof ZipError ? e.message : "Could not be read." });
      continue;
    }
    const actual = sha256Hex(bytes);
    const matches = actual === f.sha256;
    if (!matches) mismatches.push({ path: f.path, expectedSha256: f.sha256, actualSha256: actual });
    files.push({
      path: f.path,
      name: f.path.split("/").pop() ?? f.path,
      bytes,
      sha256: actual,
      mediaType: f.mediaType ?? null,
      docType: f.docType ?? null,
      title: f.title ?? null,
      integrity: matches ? { status: "verified" } : { status: "mismatch", expectedSha256: f.sha256 },
    });
  }

  const unlisted: string[] = [];
  for (const e of zip.entries) {
    if (e.isDirectory || e.name === "manifest.json" || seen.has(e.name)) continue;
    if (!SUPPORTED_ENTRY.test(e.name)) {
      skipped.push({ path: e.name, reason: "Not in the manifest, and not a PDF, image, Excel or CSV file." });
      continue;
    }
    let bytes: Uint8Array;
    try {
      bytes = zip.read(e.name);
    } catch (err) {
      skipped.push({ path: e.name, reason: err instanceof ZipError ? err.message : "Could not be read." });
      continue;
    }
    unlisted.push(e.name);
    files.push({
      path: e.name,
      name: e.name.split("/").pop() ?? e.name,
      bytes,
      sha256: sha256Hex(bytes),
      mediaType: null,
      docType: null,
      title: null,
      integrity: { status: "not_listed" },
    });
  }

  if (files.length === 0) {
    throw new EvidencePackError(
      "None of the files in this evidence pack could be imported.",
      skipped.map((s) => `${s.path}: ${s.reason}`)
    );
  }
  return {
    adapter: PACK_ADAPTER_ID,
    manifest,
    files,
    skipped,
    unlisted,
    mismatches,
    warnings,
  };
}

/**
 * Read an uploaded ZIP. Refuses only what cannot be read at all: a file that is
 * not a ZIP, or an archive with nothing importable. Everything else imports, with
 * problems reported rather than enforced.
 */
export function importEvidencePack(data: Uint8Array): ImportedPack {
  let zip: ZipArchive;
  try {
    zip = openZip(data);
  } catch (e) {
    if (e instanceof ZipError) throw new EvidencePackError(`Not a readable archive: ${e.message}`);
    throw e;
  }

  if (!zip.has("manifest.json")) {
    return plainFolder(zip, [], []);
  }
  let manifest: EvidencePackManifest;
  try {
    manifest = parseManifest(zip.readText("manifest.json"));
  } catch (e) {
    const reason = e instanceof Error ? e.message : "could not be read";
    return plainFolder(
      zip,
      [`manifest.json was ignored (${reason}) and the files were imported without manifest checks.`],
      []
    );
  }
  return manifestPack(zip, manifest, []);
}
