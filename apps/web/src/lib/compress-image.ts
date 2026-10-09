import imageCompression from "browser-image-compression";
import {
  COMPRESSION_TARGET_MB,
  IMAGE_TYPES,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_DIMENSION,
  MAX_ORIGINAL_BYTES,
  type ImageType,
} from "./images";

export type CompressionError = "unsupportedType" | "originalTooLarge" | "couldNotShrink";

export type CompressionResult =
  | { ok: true; file: File; originalBytes: number }
  | { ok: false; error: CompressionError };

export type CompressionOptions = {
  /** Longest side in pixels after resizing. Default: product photos (1600). */
  maxDimension?: number;
  /**
   * Output type when the browser cannot encode WebP. JPEG for photos; use PNG for logos,
   * since JPEG has no transparency (a transparent logo would get a black background).
   */
  fallbackType?: "image/jpeg" | "image/png";
};

let webpEncoding: boolean | undefined;
/**
 * Can this browser ENCODE WebP from a canvas? (All browsers can show it.) Some, notably
 * Safari, silently return PNG instead, and a PNG of a photo will not fit under 1 MB.
 */
function canEncodeWebp(): boolean {
  webpEncoding ??= document
    .createElement("canvas")
    .toDataURL("image/webp")
    .startsWith("data:image/webp");
  return webpEncoding;
}

/**
 * Browser-side: shrink an image to a WebP (or the fallback type where WebP cannot be
 * encoded) under MAX_IMAGE_BYTES before uploading. Re-encoding through a canvas also strips
 * EXIF metadata (GPS position, camera, ...). The server checks size and real type again;
 * this only saves the merchant's bandwidth and makes big phone photos fit.
 */
export async function compressForUpload(
  file: File,
  { maxDimension = MAX_IMAGE_DIMENSION, fallbackType = "image/jpeg" }: CompressionOptions = {},
): Promise<CompressionResult> {
  if (!(IMAGE_TYPES as readonly string[]).includes(file.type as ImageType)) {
    return { ok: false, error: "unsupportedType" };
  }
  if (file.size > MAX_ORIGINAL_BYTES) return { ok: false, error: "originalTooLarge" };

  const compressed = await imageCompression(file, {
    maxSizeMB: COMPRESSION_TARGET_MB,
    maxWidthOrHeight: maxDimension,
    fileType: canEncodeWebp() ? "image/webp" : fallbackType,
    initialQuality: 0.85,
    maxIteration: 12,
    // The default worker script is downloaded from a CDN (cdn.jsdelivr.net); running on
    // the main thread avoids loading third-party code on the merchant's page.
    useWebWorker: false,
  });

  if (compressed.size > MAX_IMAGE_BYTES) return { ok: false, error: "couldNotShrink" };
  return { ok: true, file: compressed, originalBytes: file.size };
}
