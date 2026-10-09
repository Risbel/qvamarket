// Image rules shared by the browser (compression target) and the server (hard checks).
// The server never trusts the client: it re-checks size and the real file type.

/** Hard limit on what the server stores. Strictly "under 1 MB" (decimal). */
export const MAX_IMAGE_BYTES = 1_000_000;
/** What the browser compresses to, a margin below the hard limit (in MiB, as the library expects). */
export const COMPRESSION_TARGET_MB = 0.9;
/** Longest side after compression, in pixels (plenty for a product photo). */
export const MAX_IMAGE_DIMENSION = 1600;
/** Largest original we accept to try compressing in the browser (phone photos are 3–12 MB). */
export const MAX_ORIGINAL_BYTES = 20_000_000;
export const MAX_IMAGES_PER_PRODUCT = 6;

export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type ImageType = (typeof IMAGE_TYPES)[number];

const EXTENSIONS: Record<ImageType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export const extensionFor = (type: ImageType) => EXTENSIONS[type];

/** The real type of a file from its first bytes (the browser-reported type is not trusted). */
export function sniffImageType(bytes: Uint8Array): ImageType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => bytes[i] === b)
  ) {
    return "image/png";
  }
  // WebP: "RIFF" <4 bytes size> "WEBP"
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

export type ImageCheck =
  | { ok: true; type: ImageType }
  | { ok: false; error: "empty" | "tooLarge" | "unsupportedType" };

export function checkImageBytes(bytes: Uint8Array): ImageCheck {
  if (bytes.length === 0) return { ok: false, error: "empty" };
  if (bytes.length > MAX_IMAGE_BYTES) return { ok: false, error: "tooLarge" };
  const type = sniffImageType(bytes);
  return type ? { ok: true, type } : { ok: false, error: "unsupportedType" };
}

/** "310 KB" / "4,2 MB" (decimal units, like the limits above). */
export function formatBytes(bytes: number, locale: string): string {
  const mb = bytes >= 1_000_000;
  return new Intl.NumberFormat(locale, {
    style: "unit",
    unit: mb ? "megabyte" : "kilobyte",
    maximumFractionDigits: mb ? 1 : 0,
  }).format(mb ? bytes / 1_000_000 : bytes / 1000);
}
