"use client";

import { useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { useRouter } from "@/i18n/navigation";
import { compressForUpload } from "@/lib/compress-image";
import {
  formatBytes,
  IMAGE_TYPES,
  MAX_IMAGE_BYTES,
  MAX_IMAGES_PER_PRODUCT,
  MAX_ORIGINAL_BYTES,
} from "@/lib/images";
import { useHydrated } from "@/lib/use-hydrated";
import {
  deleteProductImageAction,
  setMainProductImageAction,
  uploadProductImageAction,
} from "@/server/product-image-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type GalleryImage = { id: string; url: string; sizeBytes: number };

type Line = { name: string; ok: boolean; text: string };

export function ProductImages({
  productId,
  productName,
  images,
}: {
  productId: string;
  productName: string;
  /** main image first */
  images: GalleryImage[];
}) {
  const t = useTranslations("Products.images");
  const locale = useLocale();
  const router = useRouter();
  const hydrated = useHydrated();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([]);

  const remaining = MAX_IMAGES_PER_PRODUCT - images.length;

  async function onFiles(files: File[]) {
    if (files.length === 0) return;
    setLines([]);
    setBusy(true);
    if (files.length > remaining) {
      setLines([{ name: "", ok: false, text: t("tooMany", { count: remaining }) }]);
      setBusy(false);
      return;
    }

    const results: Line[] = [];
    for (const file of files) {
      setStatus(t("compressing", { name: file.name }));
      let compressed: Awaited<ReturnType<typeof compressForUpload>>;
      try {
        compressed = await compressForUpload(file);
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
        body.append("file", compressed.file, compressed.file.type === "image/jpeg" ? "image.jpg" : "image.webp");
        const result = await uploadProductImageAction(productId, body);
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
            : { name: file.name, ok: false, text: t(`errors.${result.error}`, { count: MAX_IMAGES_PER_PRODUCT }) },
        );
      } catch {
        // e.g. the request was rejected before reaching the action (body too large)
        results.push({ name: file.name, ok: false, text: t("errors.failed") });
      }
    }

    setStatus(null);
    setBusy(false);
    setLines(results);
    const uploaded = results.filter((line) => line.ok).length;
    if (uploaded > 0) toast.success(t("toasts.uploaded", { count: uploaded }));
    if (inputRef.current) inputRef.current.value = "";
    router.refresh();
  }

  async function run(id: string, action: (id: string) => ReturnType<typeof deleteProductImageAction>, success: string) {
    setBusy(true);
    setLines([]);
    const result = await action(id);
    if (result.ok) toast.success(success);
    else if (result.error !== "notFound") {
      setLines([{ name: "", ok: false, text: t(`errors.${result.error}`, { count: MAX_IMAGES_PER_PRODUCT }) }]);
    }
    setBusy(false);
    router.refresh();
  }

  return (
    <section className="flex flex-col gap-4" aria-labelledby="images-title">
      <div>
        <h2 id="images-title" className="text-lg font-semibold">
          {t("title")}{" "}
          <span className="text-sm font-normal text-muted-foreground">
            {t("count", { count: images.length, max: MAX_IMAGES_PER_PRODUCT })}
          </span>
        </h2>
        <p className="text-sm text-muted-foreground">
          {t("help", { limit: formatBytes(MAX_IMAGE_BYTES, locale) })}
        </p>
      </div>

      {images.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {images.map((image, index) => (
            <li key={image.id} className="flex flex-col gap-2 rounded-lg border p-2">
              <div className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element -- files come from our own S3 bucket and are already compressed */}
                <img
                  src={image.url}
                  alt={productName}
                  width={240}
                  height={240}
                  loading="lazy"
                  className="aspect-square w-full rounded-md object-cover"
                />
                {index === 0 && (
                  <Badge className="absolute left-2 top-2">{t("main")}</Badge>
                )}
              </div>
              <div className="text-xs text-muted-foreground">
                {formatBytes(image.sizeBytes, locale)}
              </div>
              <div className="flex flex-wrap gap-2">
                {index !== 0 && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={!hydrated || busy}
                    onClick={() => run(image.id, setMainProductImageAction, t("toasts.mainChanged"))}
                  >
                    {t("makeMain")}
                  </Button>
                )}
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={!hydrated || busy}
                  onClick={() => run(image.id, deleteProductImageAction, t("toasts.removed"))}
                >
                  {t("remove")}
                </Button>
              </div>
            </li>
          ))}
        </ul>
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
    </section>
  );
}
