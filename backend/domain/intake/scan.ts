/**
 * Image and scan pre-check (DFD 2.7).
 *
 * What this does: read the format and pixel dimensions from the file header and
 * judge whether a scan is good enough to read. What it does not do: deskew,
 * denoise, binarise or touch pixels at all. There is no image library in this
 * build, and altering evidence before it is hashed would break the audit trail
 * anyway. The original bytes are what is stored and hashed; this check only
 * advises the uploader and the extraction route.
 */

export type ScanFormat = "png" | "jpeg" | "webp" | "tiff" | "pdf" | "unknown";

export interface ScanAssessment {
  format: ScanFormat;
  width: number | null;
  height: number | null;
  megapixels: number | null;
  /** ok: read as is. warn: readable but likely to lose values. poor: ask for a rescan. */
  quality: "ok" | "warn" | "poor" | "unknown";
  issues: string[];
}

/** Below this the long edge of an A4 page is under ~1,200 px, roughly 100 dpi or less. */
export const MIN_LONG_EDGE_PX = 1_200;
export const POOR_LONG_EDGE_PX = 800;

function u16be(b: Uint8Array, o: number): number {
  return (b[o]! << 8) | b[o + 1]!;
}
function u32be(b: Uint8Array, o: number): number {
  return ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0;
}

export function readImageDimensions(
  b: Uint8Array
): { format: ScanFormat; width: number; height: number } | { format: ScanFormat; width: null; height: null } {
  // PNG: 8-byte signature, then IHDR with width/height at 16..24.
  if (b.length >= 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    return { format: "png", width: u32be(b, 16), height: u32be(b, 20) };
  }
  // JPEG: walk segments to the first SOFn marker.
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let o = 2;
    while (o + 9 < b.length) {
      if (b[o] !== 0xff) {
        o++;
        continue;
      }
      const marker = b[o + 1]!;
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
        o += 2;
        continue;
      }
      const len = u16be(b, o + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { format: "jpeg", height: u16be(b, o + 5), width: u16be(b, o + 7) };
      }
      o += 2 + len;
    }
    return { format: "jpeg", width: null, height: null };
  }
  // WEBP (RIFF....WEBP, VP8 / VP8L / VP8X)
  if (b.length >= 30 && b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57 && b[9] === 0x45) {
    const kind = String.fromCharCode(b[12]!, b[13]!, b[14]!, b[15]!);
    if (kind === "VP8X") {
      const w = 1 + (b[24]! | (b[25]! << 8) | (b[26]! << 16));
      const h = 1 + (b[27]! | (b[28]! << 8) | (b[29]! << 16));
      return { format: "webp", width: w, height: h };
    }
    if (kind === "VP8 ") {
      return { format: "webp", width: (b[26]! | (b[27]! << 8)) & 0x3fff, height: (b[28]! | (b[29]! << 8)) & 0x3fff };
    }
    if (kind === "VP8L") {
      const bits = b[21]! | (b[22]! << 8) | (b[23]! << 16) | (b[24]! << 24);
      return { format: "webp", width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    return { format: "webp", width: null, height: null };
  }
  if (b.length >= 4 && ((b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a) || (b[0] === 0x4d && b[1] === 0x4d && b[3] === 0x2a))) {
    return { format: "tiff", width: null, height: null };
  }
  if (b.length >= 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) {
    return { format: "pdf", width: null, height: null };
  }
  return { format: "unknown", width: null, height: null };
}

export function assessScan(bytes: Uint8Array): ScanAssessment {
  const { format, width, height } = readImageDimensions(bytes);
  const issues: string[] = [];
  if (format === "unknown") {
    return { format, width: null, height: null, megapixels: null, quality: "unknown", issues: ["The file type is not a recognised image or PDF."] };
  }
  if (width === null || height === null) {
    return { format, width: null, height: null, megapixels: null, quality: "unknown", issues: [] };
  }
  const longEdge = Math.max(width, height);
  const megapixels = Math.round(((width * height) / 1_000_000) * 100) / 100;
  let quality: ScanAssessment["quality"] = "ok";
  if (width < 1 || height < 1) {
    return { format, width, height, megapixels, quality: "poor", issues: ["The image reports zero size."] };
  }
  if (longEdge < POOR_LONG_EDGE_PX) {
    quality = "poor";
    issues.push(
      `Resolution is ${width} x ${height}. Small print on bills and certificates will not be legible; ask for a rescan at 200 dpi or more.`
    );
  } else if (longEdge < MIN_LONG_EDGE_PX) {
    quality = "warn";
    issues.push(`Resolution is ${width} x ${height}, which may lose digits. A 200 dpi scan is safer.`);
  }
  const ratio = Math.max(width, height) / Math.min(width, height);
  if (ratio > 4) {
    if (quality === "ok") quality = "warn";
    issues.push("The image is a very narrow strip. It may be a cropped receipt rather than a whole page.");
  }
  return { format, width, height, megapixels, quality, issues };
}
