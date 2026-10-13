"use client";

import { useRef, useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { compressForUpload } from "@/lib/compress-image";
import {
  BANNER_MAX_DIMENSION,
  formatBytes,
  IMAGE_TYPES,
  MAX_BANNER_IMAGES,
  MAX_IMAGE_BYTES,
  MAX_ORIGINAL_BYTES,
} from "@/lib/images";
import { useHydrated } from "@/lib/use-hydrated";
import {
  deleteBannerImageAction,
  moveBannerImageAction,
  uploadBannerImageAction,
  type BannerActionResult,
} from "@/server/banner-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type BannerImage = { id: string; url: string; sizeBytes: number };

type Line = { name: string; ok: boolean; text: string };

/** Banner images in display order: upload (several at once), reorder, remove. */
export function BannerImages({ images }: { images: BannerImage[] }) {
  const t = useTranslations("Banner");
  const locale = useLocale();
  const router = useRouter();
  const hydrated = useHydrated();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([]);

  const remaining = MAX_BANNER_IMAGES - images.length;
  const errorText = (error: Exclude<BannerActionResult, { ok: true }>["error"]) =>
    t(`errors.${error}`, { count: MAX_BANNER_IMAGES, limit: formatBytes(MAX_IMAGE_BYTES, locale) });

  async function onFiles(files: File[]) {
    if (files.length === 0) return;
    setLines([]);
    setBusy(true);
    if (files.length > remaining) {
      setLines([{ name: "", ok: false, text: t("tooMany", { count: remaining }) }]);
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
      return;
    }

    const results: Line[] = [];
    for (const file of files) {
      setStatus(t("compressing", { name: file.name }));
      let compressed: Awaited<ReturnType<typeof compressForUpload>>;
      try {
        compressed = await compressForUpload(file, { maxDimension: BANNER_MAX_DIMENSION });
      } catch {
        // the browser could not decode the file (corrupt, or not really an image)
        results.push({ name: file.name, ok: false, text: t("errors.unreadable") });
        continue;
      }

      try {
        if (!compressed.ok) {
          results.push({
            name: file.name,
            ok: false,
            text: t(`errors.${compressed.error}`, {
              max: formatBytes(MAX_ORIGINAL_BYTES, locale),
              limit: formatBytes(MAX_IMAGE_BYTES, locale),
            }),
          });
          continue;
        }

        setStatus(t("uploading", { name: file.name }));
        const body = new FormData();
        body.append("file", compressed.file, compressed.file.type === "image/jpeg" ? "banner.jpg" : "banner.webp");
        const result = await uploadBannerImageAction(body);
        results.push(
          result.ok
            ? {
                name: file.name,
                ok: true,
                text: t("compressedInfo", {
                  from: formatBytes(compressed.originalBytes, locale),
                  to: formatBytes(compressed.file.size, locale),
                }),
              }
            : { name: file.name, ok: false, text: errorText(result.error) },
        );
      } catch {
        // e.g. the request was rejected before reaching the action (body too large)
        results.push({ name: file.name, ok: false, text: t("errors.failed") });
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
        setLines([{ name: "", ok: false, text: errorText(result.error) }]);
      }
    } catch {
      setLines([{ name: "", ok: false, text: t("errors.failed") }]);
    }
    setBusy(false);
    router.refresh();
  }

  return (
    // The page's section header already names it; this adds the rules and the count
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        {t("help", { limit: formatBytes(MAX_IMAGE_BYTES, locale) })}{" "}
        <span className="font-medium text-foreground">
          {t("count", { count: images.length, max: MAX_BANNER_IMAGES })}
        </span>
      </p>

      {images.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <ol className="flex flex-col gap-3">
          {images.map((image, index) => (
            <li key={image.id} className="flex flex-col gap-3 rounded-lg border p-2 sm:flex-row sm:items-center">
              {/* eslint-disable-next-line @next/next/no-img-element -- files come from our own S3 bucket and are already compressed */}
              <img
                src={image.url}
                alt={t("position", { position: index + 1 })}
                width={320}
                height={160}
                loading="lazy"
                className="aspect-[2/1] w-full rounded-md bg-muted object-cover sm:w-64"
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
            aria-label={t("add")}
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
            <li key={i} className={line.ok ? "text-muted-foreground" : "text-destructive"}>
              {line.name && <span className="font-medium">{line.name}: </span>}
              {line.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
