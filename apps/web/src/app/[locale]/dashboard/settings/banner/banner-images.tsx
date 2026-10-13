"use client";

import { useRef, useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { compressForUpload } from "@/lib/compress-image";
import {
  BANNER_FORMATS,
  fitsBannerFormat,
  formatBytes,
  IMAGE_TYPES,
  MAX_BANNER_IMAGES,
  MAX_IMAGE_BYTES,
  MAX_ORIGINAL_BYTES,
  type BannerDevice,
} from "@/lib/images";
import { useHydrated } from "@/lib/use-hydrated";
import { cn } from "@/lib/utils";
import {
  deleteBannerImageAction,
  moveBannerImageAction,
  uploadBannerImageAction,
  type BannerActionResult,
} from "@/server/banner-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type BannerImage = { id: string; url: string; sizeBytes: number };

type Line = { name: string; tone: "ok" | "warn" | "error"; text: string };

const TONES: Record<Line["tone"], string> = {
  ok: "text-muted-foreground",
  warn: "text-amber-700 dark:text-amber-400",
  error: "text-destructive",
};

// Same shapes as the storefront hero (literal class names for Tailwind)
const PREVIEW_CLASSES: Record<BannerDevice, string> = {
  desktop: "aspect-[48/13] sm:w-80",
  mobile: "aspect-square sm:w-40",
};

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
 * The banner images of one device (desktop or mobile) in display order: upload (several at
 * once), reorder, remove. Warns when an image's shape differs from the device's format, since
 * it will be cropped to fill (and banners usually carry text).
 */
export function BannerImages({ device, images }: { device: BannerDevice; images: BannerImage[] }) {
  const t = useTranslations("Banner");
  const locale = useLocale();
  const router = useRouter();
  const hydrated = useHydrated();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([]);

  const format = BANNER_FORMATS[device];
  const formatValues = {
    shape: t(`devices.${device}.shape`),
    size: `${format.width} × ${format.height}`,
  };
  const titleId = `banner-${device}-title`;
  const remaining = MAX_BANNER_IMAGES - images.length;
  const errorText = (error: Exclude<BannerActionResult, { ok: true }>["error"]) =>
    t(`errors.${error}`, { count: MAX_BANNER_IMAGES, limit: formatBytes(MAX_IMAGE_BYTES, locale) });

  async function onFiles(files: File[]) {
    if (files.length === 0) return;
    setLines([]);
    setBusy(true);
    if (files.length > remaining) {
      setLines([{ name: "", tone: "error", text: t("tooMany", { count: remaining }) }]);
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
      return;
    }

    const results: Line[] = [];
    for (const file of files) {
      setStatus(t("compressing", { name: file.name }));
      let compressed: Awaited<ReturnType<typeof compressForUpload>>;
      try {
        compressed = await compressForUpload(file, { maxDimension: format.maxDimension });
      } catch {
        // the browser could not decode the file (corrupt, or not really an image)
        results.push({ name: file.name, tone: "error", text: t("errors.unreadable") });
        continue;
      }

      try {
        if (!compressed.ok) {
          results.push({
            name: file.name,
            tone: "error",
            text: t(`errors.${compressed.error}`, {
              max: formatBytes(MAX_ORIGINAL_BYTES, locale),
              limit: formatBytes(MAX_IMAGE_BYTES, locale),
            }),
          });
          continue;
        }

        setStatus(t("uploading", { name: file.name }));
        const body = new FormData();
        body.append("device", device);
        body.append("file", compressed.file, compressed.file.type === "image/jpeg" ? "banner.jpg" : "banner.webp");
        const result = await uploadBannerImageAction(body);
        if (!result.ok) {
          results.push({ name: file.name, tone: "error", text: errorText(result.error) });
          continue;
        }

        const uploaded = t("compressedInfo", {
          from: formatBytes(compressed.originalBytes, locale),
          to: formatBytes(compressed.file.size, locale),
        });
        // Uploaded either way (the merchant may accept the crop), but say what will happen
        const size = await imageSize(compressed.file);
        results.push(
          size && !fitsBannerFormat(device, size.width, size.height)
            ? {
                name: file.name,
                tone: "warn",
                text: `${uploaded}. ${t("shapeWarning", { width: size.width, height: size.height, ...formatValues })}`,
              }
            : { name: file.name, tone: "ok", text: uploaded },
        );
      } catch {
        // e.g. the request was rejected before reaching the action (body too large)
        results.push({ name: file.name, tone: "error", text: t("errors.failed") });
      }
    }

    setStatus(null);
    setBusy(false);
    setLines(results);
    if (inputRef.current) inputRef.current.value = "";
    router.refresh();
  }

  async function run(action: () => Promise<BannerActionResult>) {
    setBusy(true);
    setLines([]);
    try {
      const result = await action();
      if (!result.ok && result.error !== "notFound") {
        setLines([{ name: "", tone: "error", text: errorText(result.error) }]);
      }
    } catch {
      setLines([{ name: "", tone: "error", text: t("errors.failed") }]);
    }
    setBusy(false);
    router.refresh();
  }

  return (
    <section className="flex flex-col gap-4" aria-labelledby={titleId}>
      <div>
        <h2 id={titleId} className="text-lg font-semibold">
          {t(`devices.${device}.title`)}{" "}
          <span className="text-sm font-normal text-muted-foreground">
            {t("count", { count: images.length, max: MAX_BANNER_IMAGES })}
          </span>
        </h2>
        <p className="text-sm text-muted-foreground">
          {t(`devices.${device}.help`, { ...formatValues, limit: formatBytes(MAX_IMAGE_BYTES, locale) })}
        </p>
      </div>

      {images.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t(`devices.${device}.empty`)}</p>
      ) : (
        <ol className="flex flex-col gap-3">
          {images.map((image, index) => (
            <li key={image.id} className="flex flex-col gap-3 rounded-lg border p-2 sm:flex-row sm:items-center">
              {/* eslint-disable-next-line @next/next/no-img-element -- files come from our own S3 bucket and are already compressed */}
              <img
                src={image.url}
                alt={t("position", { position: index + 1 })}
                width={format.width}
                height={format.height}
                loading="lazy"
                className={cn("w-full rounded-md bg-muted object-cover", PREVIEW_CLASSES[device])}
              />
              <div className="flex flex-1 flex-col gap-2">
                <div className="text-sm">
                  <span className="font-medium">{t("position", { position: index + 1 })}</span>{" "}
                  <span className="text-muted-foreground">· {formatBytes(image.sizeBytes, locale)}</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={!hydrated || busy || index === 0}
                    onClick={() => run(() => moveBannerImageAction(image.id, "up"))}
                  >
                    <ArrowUp aria-hidden />
                    {t("moveUp")}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={!hydrated || busy || index === images.length - 1}
                    onClick={() => run(() => moveBannerImageAction(image.id, "down"))}
                  >
                    <ArrowDown aria-hidden />
                    {t("moveDown")}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={!hydrated || busy}
                    onClick={() => run(() => deleteBannerImageAction(image.id))}
                  >
                    {t("remove")}
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}

      {remaining > 0 && (
        <div className="flex flex-col gap-2">
          <Input
            ref={inputRef}
            type="file"
            multiple
            accept={IMAGE_TYPES.join(",")}
            aria-label={t("add", { device: t(`devices.${device}.title`) })}
            disabled={!hydrated || busy}
            onChange={(event) => onFiles(Array.from(event.target.files ?? []))}
          />
          {status && (
            <p role="status" className="text-sm text-muted-foreground">
              {status}
            </p>
          )}
        </div>
      )}

      {lines.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm" aria-live="polite">
          {lines.map((line, i) => (
            <li key={i} className={TONES[line.tone]}>
              {line.name && <span className="font-medium">{line.name}: </span>}
              {line.text}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
