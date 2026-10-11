/**
 * Minimal ZIP reader and writer, dependency-free.
 *
 * The reader backs XLSX parsing and third-party evidence-pack import; the writer
 * backs the submission package. Supported: stored and deflate entries, no
 * encryption, no ZIP64, no multi-disk. Anything else is refused with a reason.
 *
 * Archives arrive from outside the firm, so the reader is defensive: entry
 * count, per-entry and total inflated size are capped (zip-bomb guard), paths
 * that escape the archive root are refused, and every offset is bounds-checked.
 */

import { inflateRawSync } from "node:zlib";

// zlib.crc32 only exists from Node 20.15, so the table is local.
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
const zlibCrc32 = crc32;

export class ZipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZipError";
  }
}

export interface ZipLimits {
  maxEntries: number;
  maxEntryBytes: number;
  maxTotalBytes: number;
}

export const DEFAULT_ZIP_LIMITS: ZipLimits = {
  maxEntries: 2_000,
  maxEntryBytes: 64 * 1024 * 1024,
  maxTotalBytes: 256 * 1024 * 1024,
};

export interface ZipEntry {
  name: string;
  /** Uncompressed size recorded in the central directory. */
  size: number;
  isDirectory: boolean;
}

export interface ZipArchive {
  entries: ZipEntry[];
  /** Inflate one entry. Throws ZipError on a corrupt entry or a size mismatch. */
  read(name: string): Uint8Array;
  has(name: string): boolean;
  readText(name: string): string;
}

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const LOC_SIG = 0x04034b50;

/** Names with `..`, absolute paths or backslashes are refused outright. */
export function isSafeZipPath(name: string): boolean {
  if (!name || name.includes("\0") || name.includes("\\")) return false;
  if (name.startsWith("/") || /^[a-zA-Z]:/.test(name)) return false;
  return !name.split("/").some((seg) => seg === "..");
}

export function openZip(data: Uint8Array, limits: ZipLimits = DEFAULT_ZIP_LIMITS): ZipArchive {
  const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  if (buf.length < 22) throw new ZipError("Not a ZIP archive: too short.");

  // The end-of-central-directory record sits in the last 64 KiB plus 22 bytes.
  let eocd = -1;
  const floor = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.length - 22; i >= floor; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ZipError("Not a ZIP archive: no end-of-directory record.");

  const entryCount = buf.readUInt16LE(eocd + 10);
  const cenSize = buf.readUInt32LE(eocd + 12);
  const cenOffset = buf.readUInt32LE(eocd + 16);
  if (entryCount === 0xffff || cenSize === 0xffffffff || cenOffset === 0xffffffff) {
    throw new ZipError("ZIP64 archives are not supported.");
  }
  if (entryCount > limits.maxEntries) {
    throw new ZipError(`Archive has ${entryCount} entries; the limit is ${limits.maxEntries}.`);
  }
  if (cenOffset + cenSize > buf.length) throw new ZipError("Corrupt ZIP: directory out of range.");

  interface Raw {
    name: string;
    method: number;
    flags: number;
    crc: number;
    compSize: number;
    size: number;
    localOffset: number;
  }
  const raws = new Map<string, Raw>();
  const entries: ZipEntry[] = [];
  let pos = cenOffset;
  let declaredTotal = 0;
  for (let n = 0; n < entryCount; n++) {
    if (pos + 46 > buf.length || buf.readUInt32LE(pos) !== CEN_SIG) {
      throw new ZipError("Corrupt ZIP: bad directory entry.");
    }
    const flags = buf.readUInt16LE(pos + 8);
    const method = buf.readUInt16LE(pos + 10);
    const crc = buf.readUInt32LE(pos + 16);
    const compSize = buf.readUInt32LE(pos + 20);
    const size = buf.readUInt32LE(pos + 24);
    const nameLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    const localOffset = buf.readUInt32LE(pos + 42);
    if (pos + 46 + nameLen > buf.length) throw new ZipError("Corrupt ZIP: name out of range.");
    const name = buf.toString(flags & 0x800 ? "utf8" : "latin1", pos + 46, pos + 46 + nameLen);
    pos += 46 + nameLen + extraLen + commentLen;

    if (!isSafeZipPath(name)) throw new ZipError(`Unsafe path in archive: "${name}".`);
    if (flags & 0x1) throw new ZipError(`Encrypted entries are not supported ("${name}").`);
    if (size > limits.maxEntryBytes) {
      throw new ZipError(`Entry "${name}" is ${size} bytes; the limit is ${limits.maxEntryBytes}.`);
    }
    declaredTotal += size;
    if (declaredTotal > limits.maxTotalBytes) {
      throw new ZipError(`Archive expands past ${limits.maxTotalBytes} bytes.`);
    }
    const isDirectory = name.endsWith("/");
    raws.set(name, { name, method, flags, crc, compSize, size, localOffset });
    entries.push({ name, size, isDirectory });
  }

  function read(name: string): Uint8Array {
    const e = raws.get(name);
    if (!e) throw new ZipError(`No entry "${name}" in archive.`);
    if (e.localOffset + 30 > buf.length || buf.readUInt32LE(e.localOffset) !== LOC_SIG) {
      throw new ZipError(`Corrupt ZIP: bad local header for "${name}".`);
    }
    const nameLen = buf.readUInt16LE(e.localOffset + 26);
    const extraLen = buf.readUInt16LE(e.localOffset + 28);
    const start = e.localOffset + 30 + nameLen + extraLen;
    const end = start + e.compSize;
    if (end > buf.length) throw new ZipError(`Corrupt ZIP: "${name}" runs past the end.`);
    const comp = buf.subarray(start, end);
    let out: Buffer;
    if (e.method === 0) {
      out = Buffer.from(comp);
    } else if (e.method === 8) {
      try {
        // maxOutputLength stops a lying header from inflating past the cap.
        out = inflateRawSync(comp, { maxOutputLength: limits.maxEntryBytes });
      } catch {
        throw new ZipError(`Entry "${name}" could not be inflated.`);
      }
    } else {
      throw new ZipError(`Entry "${name}" uses unsupported compression method ${e.method}.`);
    }
    if (out.length !== e.size) throw new ZipError(`Entry "${name}" size does not match its header.`);
    if (zlibCrc32(out) !== e.crc) throw new ZipError(`Entry "${name}" failed its checksum.`);
    return out;
  }

  return {
    entries,
    read,
    has: (name) => raws.has(name),
    readText: (name) => Buffer.from(read(name)).toString("utf8"),
  };
}

export interface ZipFileInput {
  name: string;
  data: Uint8Array | string;
}

/**
 * Write a ZIP with stored (uncompressed) entries. Output is deterministic: the
 * same files in the same order produce the same bytes, because every timestamp
 * is fixed. That keeps a submission package hashable.
 */
export function writeZip(files: ZipFileInput[]): Uint8Array {
  const DOS_TIME = 0;
  const DOS_DATE = (1 << 5) | 1; // 1980-01-01
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const f of files) {
    if (!isSafeZipPath(f.name)) throw new ZipError(`Unsafe path for archive: "${f.name}".`);
    const nameBuf = Buffer.from(f.name, "utf8");
    const data = typeof f.data === "string" ? Buffer.from(f.data, "utf8") : Buffer.from(f.data);
    const crc = zlibCrc32(data);

    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(LOC_SIG, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    nameBuf.copy(local, 30);

    const central = Buffer.alloc(46 + nameBuf.length);
    central.writeUInt32LE(CEN_SIG, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    nameBuf.copy(central, 46);

    locals.push(local, data);
    centrals.push(central);
    offset += local.length + data.length;
  }

  const cenSize = centrals.reduce((s, b) => s + b.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(EOCD_SIG, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cenSize, 12);
  eocd.writeUInt32LE(offset, 16);

  return new Uint8Array(Buffer.concat([...locals, ...centrals, eocd]));
}
