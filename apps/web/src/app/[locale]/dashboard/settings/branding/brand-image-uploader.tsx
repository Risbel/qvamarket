"use client";

import { useState } from "react";
import { ImageUpIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { useRouter } from "@/i18n/navigation";
import { compressForUpload } from "@/lib/compress-image";
import {
  BRAND_IMAGE_MAX_DIMENSION,
  formatBytes,
  IMAGE_TYPES,
  MAX_IMAGE_BYTES,
  MAX_ORIGINAL_BYTES,
  type BrandImageKind,
} from "@/lib/images";
import { useHydrated } from "@/lib/use-hydrated";
import { removeBrandImageAction, uploadBrandImageAction } from "@/server/branding-actions";
import { Button } from "@/components/ui/button";
import { Dropzone, DropzoneDescription, DropzoneIcon, DropzoneTitle } from "@/components/ui/dropzone";

/** Upload / replace / remove the store's logo or logotype (same pipeline, different shape). */
export function BrandImageUploader({
  kind,
  imageUrl,
  storeName,
}: {
  kind: BrandImageKind;
  imageUrl: string | null;
  storeName: string;
}) {
  const t = useTranslations("Branding");
  const locale = useLocale();
  const router = useRouter();
  const hydrated = useHydrated();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const maxDimension = BRAND_IMAGE_MAX_DIMENSION[kind];
  const titleId = `${kind}-title`;

  async function onFile(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setMessage(null);
    try {
      let compressed: Awaited<ReturnType<typeof compressForUpload>>;
      try {
        // PNG as fallback (not JPEG): a transparent logo must not get a black background
        compressed = await compressForUpload(file, { maxDimension, fallbackType: "image/png" });
      } catch {
        setMessage({ ok: false, text: t("upload.errors.unreadable") });
        return;
      }
      if (!compressed.ok) {
        setMessage({
          ok: false,
          text: t(`upload.errors.${compressed.error}`, {
            max: formatBytes(MAX_ORIGINAL_BYTES, locale),
            limit: formatBytes(MAX_IMAGE_BYTES, locale),
          }),
        });
        return;
      }
      setMessage({ ok: true, text: t("upload.uploading") });
      const body = new FormData();
      body.append("file", compressed.file, compressed.file.type === "image/png" ? `${kind}.png` : `${kind}.webp`);
      const result = await uploadBrandImageAction(kind, body);
      if (result.ok) {
        setMessage(null);
        toast.success(
          t(`${kind}.uploaded`, {
            from: formatBytes(compressed.originalBytes, locale),
            to: formatBytes(compressed.file.size, locale),
          }),
        );
      } else {
        setMessage({
          ok: false,
          text: t(`upload.errors.${result.error === "invalid" ? "failed" : result.error}`, {
            limit: formatBytes(MAX_IMAGE_BYTES, locale),
          }),
        });
      }
      router.refresh();
    } catch {
      setMessage({ ok: false, text: t("upload.errors.failed") });
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setMessage(null);
    const result = await removeBrandImageAction(kind);
    if (result.ok) toast.success(t(`${kind}.removed`));
    else setMessage({ ok: false, text: t("upload.errors.failed") });
    setBusy(false);
    router.refresh();
  }

  return (
    <section className="flex flex-col gap-3" aria-labelledby={titleId}>
      <div>
        <h2 id={titleId} className="text-lg font-semibold">
          {t(`${kind}.title`)}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t(`${kind}.help`, { size: maxDimension, limit: formatBytes(MAX_IMAGE_BYTES, locale) })}
        </p>
      </div>

      {imageUrl ? (
        <div className="flex flex-wrap items-center gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element -- our own bucket, already compressed */}
          <img
            src={imageUrl}
            alt={storeName}
            className={
              kind === "logo"
                ? "size-24 rounded-lg border bg-muted/40 object-contain p-1"
                : "h-24 w-auto max-w-full rounded-lg border bg-muted/40 object-contain p-2"
            }
          />
          <Button type="button" variant="outline" size="sm" disabled={!hydrated || busy} onClick={remove}>
            {t(`${kind}.remove`)}
          </Button>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{t(`${kind}.none`)}</p>
      )}

      <Dropzone
        accept={IMAGE_TYPES}
        disabled={!hydrated || busy}
        inputProps={{ "aria-label": imageUrl ? t(`${kind}.replace`) : t(`${kind}.upload`) }}
        onFiles={(files) => onFile(files[0])}
        onReject={() => setMessage({ ok: false, text: t("upload.errors.unsupportedType") })}
      >
        <DropzoneIcon>
          <ImageUpIcon aria-hidden />
        </DropzoneIcon>
        <DropzoneTitle>{t("upload.dropTitle")}</DropzoneTitle>
        <DropzoneDescription>{t("upload.dropDescription")}</DropzoneDescription>
      </Dropzone>
      {message && (
        <p role="status" aria-live="polite" className={message.ok ? "text-sm text-muted-foreground" : "text-sm text-destructive"}>
          {message.text}
        </p>
      )}
    </section>
  );
}
