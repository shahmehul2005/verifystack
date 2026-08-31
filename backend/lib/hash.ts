import "server-only";
import { createHash } from "node:crypto";

/** Content-addressed storage key: sha256 of raw bytes. */
export function sha256Bytes(bytes: Uint8Array | Buffer | ArrayBuffer): string {
  const buf = Buffer.isBuffer(bytes)
    ? bytes
    : bytes instanceof ArrayBuffer
      ? Buffer.from(bytes)
      : Buffer.from(bytes);
  return createHash("sha256").update(buf).digest("hex");
}

export function evidenceObjectKey(sha256: string): string {
  return sha256;
}

export function evidenceStoragePath(sha256: string): string {
  return sha256;
}
