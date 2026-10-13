import type { BANNER_DEVICES as DB_BANNER_DEVICES } from "@qvashop/db/schema";

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
/** Hero banner of the storefront: at most this many images per screen size. */
export const MAX_BANNER_IMAGES = 5;

/**
 * Banner screen sizes: desktop images are only shown from the `md` breakpoint (768 px) up,
 * mobile images only below it. Client-safe copy of the schema list.
 */
export const BANNER_DEVICES = ["desktop", "mobile"] as const satisfies typeof DB_BANNER_DEVICES;
export type BannerDevice = (typeof BANNER_DEVICES)[number];

/**
 * Shape of each screen size's banner (the recommended upload size; images are shown at this
 * ratio and cropped to fill) and the longest side after compression. Desktop: a wide
 * panoramic strip (1920 x 520, about 3.7:1, a common web banner size); the storefront is
 * 1024 css px wide, so 2048 stays sharp on 2x screens. Mobile: square, about 390 css px x 3.
 */
export type ImageFormat = { width: number; height: number; maxDimension: number };

export const BANNER_FORMATS: Record<BannerDevice, ImageFormat> = {
  desktop: { width: 1920, height: 520, maxDimension: 2048 },
  mobile: { width: 1080, height: 1080, maxDimension: 1200 },
};

/** Secondary banner (pairs of tiles under the hero): at most this many pairs per screen size. */
export const MAX_SECONDARY_BANNER_PAIRS = 5;
export const SECONDARY_BANNER_SIDES = ["left", "right"] as const;
export type SecondaryBannerSide = (typeof SECONDARY_BANNER_SIDES)[number];

/**
 * Shape of ONE tile of the secondary banner (two tiles side by side). Desktop: the hero's
 * panoramic shape at half width (about 500 x 135 css px). Mobile: square, since a tile is only
 * about 170 css px wide on a phone and a flat one would make its text unreadable.
 */
export const SECONDARY_BANNER_FORMATS: Record<BannerDevice, ImageFormat> = {
  desktop: { width: 960, height: 260, maxDimension: 1200 },
  mobile: { width: 600, height: 600, maxDimension: 720 },
};

/** True when an image's shape is within 3% of the format's, so cropping is negligible. */
export function fitsFormat(format: ImageFormat, width: number, height: number) {
  return Math.abs(width / height / (format.width / format.height) - 1) <= 0.03;
}

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
