"use client";

import { useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { compressForUpload } from "@/lib/compress-image";
import { formatBytes, IMAGE_TYPES, MAX_IMAGE_BYTES, MAX_ORIGINAL_BYTES } from "@/lib/images";
import { useHydrated } from "@/lib/use-hydrated";
import { removeLogoAction, uploadLogoAction } from "@/server/branding-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Longest side of a stored logo: plenty for a header, keeps the file tiny. */
const LOGO_MAX_DIMENSION = 512;

export function LogoUploader({ logoUrl, storeName }: { logoUrl: string | null; storeName: string }) {
  const t = useTranslations("Branding.logo");
  const locale = useLocale();
  const router = useRouter();
  const hydrated = useHydrated();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setMessage(null);
    try {
      let compressed: Awaited<ReturnType<typeof compressForUpload>>;
      try {
        // PNG as fallback (not JPEG): a transparent logo must not get a black background
        compressed = await compressForUpload(file, {
          maxDimension: LOGO_MAX_DIMENSION,
          fallbackType: "image/png",
        });
      } catch {
        setMessage({ ok: false, text: t("errors.unreadable") });
        return;
      }
      if (!compressed.ok) {
        setMessage({
          ok: false,
          text: t(`errors.${compressed.error}`, {
            max: formatBytes(MAX_ORIGINAL_BYTES, locale),
            limit: formatBytes(MAX_IMAGE_BYTES, locale),
          }),
        });
        return;
      }
      setMessage({ ok: true, text: t("uploading") });
      const body = new FormData();
      body.append("file", compressed.file, compressed.file.type === "image/png" ? "logo.png" : "logo.webp");
      const result = await uploadLogoAction(body);
      setMessage(
        result.ok
          ? {
              ok: true,
              text: t("uploaded", {
                from: formatBytes(compressed.originalBytes, locale),
                to: formatBytes(compressed.file.size, locale),
              }),
            }
          : { ok: false, text: t(`errors.${result.error}`, { limit: formatBytes(MAX_IMAGE_BYTES, locale) }) },
      );
      router.refresh();
    } catch {
      setMessage({ ok: false, text: t("errors.failed") });
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function remove() {
    setBusy(true);
    setMessage(null);
    const result = await removeLogoAction();
    setMessage(result.ok ? { ok: true, text: t("removed") } : { ok: false, text: t("errors.failed") });
    setBusy(false);
    router.refresh();
  }

  return (
    <section className="flex flex-col gap-3" aria-labelledby="logo-title">
      <div>
        <h2 id="logo-title" className="text-lg font-semibold">
          {t("title")}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t("help", { size: LOGO_MAX_DIMENSION, limit: formatBytes(MAX_IMAGE_BYTES, locale) })}
        </p>
      </div>

      {logoUrl ? (
        <div className="flex items-center gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element -- our own bucket, already compressed */}
          <img
            src={logoUrl}
            alt={storeName}
            width={96}
            height={96}
            className="size-24 rounded-lg border bg-muted/40 object-contain p-1"
          />
          <Button type="button" variant="outline" size="sm" disabled={!hydrated || busy} onClick={remove}>
            {t("remove")}
          </Button>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{t("none")}</p>
      )}

      <Input
        ref={inputRef}
        type="file"
        accept={IMAGE_TYPES.join(",")}
        aria-label={logoUrl ? t("replace") : t("upload")}
        disabled={!hydrated || busy}
        onChange={(event) => onFile(event.target.files?.[0])}
      />
      {message && (
        <p role="status" aria-live="polite" className={message.ok ? "text-sm text-muted-foreground" : "text-sm text-destructive"}>
          {message.text}
        </p>
      )}
    </section>
  );
}
