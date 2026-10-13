"use client";

import { useRef, useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import {
  BANNER_FORMATS,
  formatBytes,
  IMAGE_TYPES,
  MAX_BANNER_IMAGES,
  MAX_IMAGE_BYTES,
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
import { LINE_TONES, uploadBannerFile, type UploadLine } from "./upload-banner-file";

export type BannerImage = { id: string; url: string; sizeBytes: number };

// Same shapes as the storefront hero (literal class names for Tailwind)
const PREVIEW_CLASSES: Record<BannerDevice, string> = {
  desktop: "aspect-[48/13] sm:w-80",
  mobile: "aspect-square sm:w-40",
};

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
  const [lines, setLines] = useState<UploadLine[]>([]);

  const format = BANNER_FORMATS[device];
  const shape = t(`devices.${device}.shape`);
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

    const results: UploadLine[] = [];
    for (const file of files) {
      results.push(
        await uploadBannerFile({
          file,
          format,
          shape,
          upload: (body) => {
            body.append("device", device);
            return uploadBannerImageAction(body);
          },
          errorText: (error) => errorText(error as Exclude<BannerActionResult, { ok: true }>["error"]),
          t,
          locale,
          onStatus: setStatus,
        }),
      );
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
          {t(`devices.${device}.help`, { shape, size: `${format.width} × ${format.height}`, limit: formatBytes(MAX_IMAGE_BYTES, locale) })}
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
            <li key={i} className={LINE_TONES[line.tone]}>
              {line.name && <span className="font-medium">{line.name}: </span>}
              {line.text}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
