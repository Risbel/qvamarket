import { compressForUpload } from "@/lib/compress-image";
import { fitsFormat, formatBytes, MAX_IMAGE_BYTES, MAX_ORIGINAL_BYTES, type ImageFormat } from "@/lib/images";

// Browser-side steps shared by the banner uploaders (main banner images and secondary banner
// tiles): compress to the format's size, upload, and warn when the image's shape differs from
// the format, since it will be cropped to fill (and banners usually carry text).

export type UploadLine = { name: string; tone: "ok" | "warn" | "error"; text: string };

export const LINE_TONES: Record<UploadLine["tone"], string> = {
  ok: "text-muted-foreground",
  warn: "text-amber-700 dark:text-amber-400",
  error: "text-destructive",
};

/** The `Banner` namespace translator (next-intl). */
type Translate = (key: string, values?: Record<string, string | number>) => string;

type UploadResult = { ok: true } | { ok: false; error: string };

/** Width and height of an image file, or null when the browser cannot tell. */
async function imageSize(file: Blob) {
  try {
    const bitmap = await createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    return null;
  }
}

/**
 * Compresses `file` for `format`, sends it with `upload` and returns the line to show:
 * an error, the size saved, or the size saved plus a crop warning (the image is uploaded
 * either way: the merchant may accept the crop).
 */
export async function uploadBannerFile({
  file,
  format,
  shape,
  upload,
  errorText,
  t,
  locale,
  onStatus,
}: {
  file: File;
  format: ImageFormat;
  /** the format's shape in words, e.g. "panorámico" */
  shape: string;
  upload: (body: FormData) => Promise<UploadResult>;
  errorText: (error: string) => string;
  t: Translate;
  locale: string;
  onStatus: (text: string) => void;
}): Promise<UploadLine> {
  const name = file.name;
  onStatus(t("compressing", { name }));
  let compressed: Awaited<ReturnType<typeof compressForUpload>>;
  try {
    compressed = await compressForUpload(file, { maxDimension: format.maxDimension });
  } catch {
    // the browser could not decode the file (corrupt, or not really an image)
    return { name, tone: "error", text: t("errors.unreadable") };
  }
  if (!compressed.ok) {
    return {
      name,
      tone: "error",
      text: t(`errors.${compressed.error}`, {
        max: formatBytes(MAX_ORIGINAL_BYTES, locale),
        limit: formatBytes(MAX_IMAGE_BYTES, locale),
      }),
    };
  }

  try {
    onStatus(t("uploading", { name }));
    const body = new FormData();
    body.append("file", compressed.file, compressed.file.type === "image/jpeg" ? "banner.jpg" : "banner.webp");
    const result = await upload(body);
    if (!result.ok) return { name, tone: "error", text: errorText(result.error) };
  } catch {
    // e.g. the request was rejected before reaching the action (body too large)
    return { name, tone: "error", text: t("errors.failed") };
  }

  const uploaded = t("compressedInfo", {
    from: formatBytes(compressed.originalBytes, locale),
    to: formatBytes(compressed.file.size, locale),
  });
  const size = await imageSize(compressed.file);
  if (size && !fitsFormat(format, size.width, size.height)) {
    const warning = t("shapeWarning", {
      width: size.width,
      height: size.height,
      shape,
      size: `${format.width} × ${format.height}`,
    });
    return { name, tone: "warn", text: `${uploaded}. ${warning}` };
  }
  return { name, tone: "ok", text: uploaded };
}
