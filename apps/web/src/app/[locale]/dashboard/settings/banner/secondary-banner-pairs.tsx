"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, ImageIcon, PlusIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { useRouter } from "@/i18n/navigation";
import {
  formatBytes,
  IMAGE_TYPES,
  MAX_IMAGE_BYTES,
  MAX_SECONDARY_BANNER_PAIRS,
  SECONDARY_BANNER_FORMATS,
  SECONDARY_BANNER_SIDES,
  type BannerDevice,
  type SecondaryBannerSide,
} from "@/lib/images";
import { useHydrated } from "@/lib/use-hydrated";
import { cn } from "@/lib/utils";
import {
  createSecondaryPairAction,
  deleteSecondaryPairAction,
  moveSecondaryPairAction,
  uploadSecondaryPairImageAction,
  type SecondaryBannerActionResult,
} from "@/server/secondary-banner-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LINE_TONES, uploadBannerFile, type UploadLine } from "./upload-banner-file";

type PairImage = { url: string; sizeBytes: number } | null;
export type SecondaryPair = { id: string; left: PairImage; right: PairImage };

// Same tile shapes as the storefront (literal class names for Tailwind)
const TILE_ASPECT: Record<BannerDevice, string> = { desktop: "aspect-[48/13]", mobile: "aspect-square" };
const PAIR_WIDTH: Record<BannerDevice, string> = { desktop: "max-w-2xl", mobile: "max-w-sm" };

/**
 * The secondary banner pairs of one device: each pair is one slide with two tiles (left and
 * right), filled one side at a time. A pair missing a side is marked and never shown.
 */
export function SecondaryBannerPairs({
  device,
  pairs,
  heroMissing,
}: {
  device: BannerDevice;
  pairs: SecondaryPair[];
  /** the main banner has no images for this device, so the storefront shows none of this */
  heroMissing: boolean;
}) {
  const t = useTranslations("Banner.secondary");
  const tb = useTranslations("Banner");
  const locale = useLocale();
  const router = useRouter();
  const hydrated = useHydrated();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [lines, setLines] = useState<UploadLine[]>([]);

  const format = SECONDARY_BANNER_FORMATS[device];
  const titleId = `secondary-${device}-title`;
  const disabled = !hydrated || busy;

  const errorText = (error: string) =>
    error === "limit" || error === "needsHero"
      ? t(`errors.${error}`, { count: MAX_SECONDARY_BANNER_PAIRS })
      : tb(`errors.${error}`, { limit: formatBytes(MAX_IMAGE_BYTES, locale) });

  /** `success`: the toast shown when it worked (none for adding or reordering, which show themselves) */
  async function run(action: () => Promise<SecondaryBannerActionResult>, success?: string) {
    setBusy(true);
    setLines([]);
    try {
      const result = await action();
      if (result.ok) {
        if (success) toast.success(success);
      } else if (result.error !== "notFound") {
        setLines([{ name: "", tone: "error", text: errorText(result.error) }]);
      }
    } catch {
      setLines([{ name: "", tone: "error", text: tb("errors.failed") }]);
    }
    setBusy(false);
    router.refresh();
  }

  async function upload(pairId: string, side: SecondaryBannerSide, input: HTMLInputElement) {
    const file = input.files?.[0];
    if (!file) return;
    setBusy(true);
    setLines([]);
    const line = await uploadBannerFile({
      file,
      format,
      shape: t(`devices.${device}.shape`),
      upload: (body) => {
        body.append("pairId", pairId);
        body.append("side", side);
        return uploadSecondaryPairImageAction(body);
      },
      errorText,
      t: tb,
      locale,
      onStatus: setStatus,
    });
    setStatus(null);
    setBusy(false);
    setLines([line]);
    if (line.tone !== "error") toast.success(tb("toasts.uploaded", { count: 1 }));
    input.value = "";
    router.refresh();
  }

  return (
    <section className="flex flex-col gap-4" aria-labelledby={titleId}>
      <div>
        <h2 id={titleId} className="text-lg font-semibold">
          {t(`devices.${device}.title`)}{" "}
          <span className="text-sm font-normal text-muted-foreground">
            {t("count", { count: pairs.length, max: MAX_SECONDARY_BANNER_PAIRS })}
          </span>
        </h2>
        <p className="text-sm text-muted-foreground">
          {t(`devices.${device}.help`, {
            shape: t(`devices.${device}.shape`),
            size: `${format.width} × ${format.height}`,
            limit: formatBytes(MAX_IMAGE_BYTES, locale),
          })}
        </p>
        {heroMissing && (
          <p className="mt-1 text-sm text-amber-700 dark:text-amber-400">{t(`devices.${device}.heroMissing`)}</p>
        )}
      </div>

      {pairs.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t(`devices.${device}.empty`)}</p>
      ) : (
        <ol className={cn("flex flex-col gap-3", PAIR_WIDTH[device])}>
          {pairs.map((pair, index) => {
            const complete = Boolean(pair.left && pair.right);
            return (
              <li key={pair.id} className="flex flex-col gap-3 rounded-lg border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{t("pair", { position: index + 1 })}</span>
                  {!complete && <Badge variant="outline">{t("incomplete")}</Badge>}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {SECONDARY_BANNER_SIDES.map((side) => {
                    const image = pair[side];
                    const label = t("sideLabel", { side: t(side), position: index + 1 });
                    return (
                      <div key={side} className="flex min-w-0 flex-col gap-2">
                        <span className="text-xs text-muted-foreground">
                          {t(side)}
                          {image && ` · ${formatBytes(image.sizeBytes, locale)}`}
                        </span>
                        {image ? (
                          // eslint-disable-next-line @next/next/no-img-element -- files come from our own S3 bucket and are already compressed
                          <img
                            src={image.url}
                            alt={label}
                            width={format.width}
                            height={format.height}
                            loading="lazy"
                            className={cn("w-full rounded-md border bg-muted object-cover", TILE_ASPECT[device])}
                          />
                        ) : (
                          <div
                            className={cn(
                              "flex w-full items-center justify-center rounded-md border border-dashed bg-muted/40 text-muted-foreground",
                              TILE_ASPECT[device],
                            )}
                          >
                            <ImageIcon className="size-5" aria-hidden />
                          </div>
                        )}
                        <Input
                          type="file"
                          accept={IMAGE_TYPES.join(",")}
                          aria-label={image ? t("replace", { label }) : t("upload", { label })}
                          disabled={disabled}
                          onChange={(event) => upload(pair.id, side, event.currentTarget)}
                          className="text-xs"
                        />
                      </div>
                    );
                  })}
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={disabled || index === 0}
                    onClick={() => run(() => moveSecondaryPairAction(pair.id, "up"))}
                  >
                    <ArrowUp aria-hidden />
                    {t("moveUp")}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={disabled || index === pairs.length - 1}
                    onClick={() => run(() => moveSecondaryPairAction(pair.id, "down"))}
                  >
                    <ArrowDown aria-hidden />
                    {t("moveDown")}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={disabled}
                    onClick={() => run(() => deleteSecondaryPairAction(pair.id), t("toasts.pairDeleted"))}
                  >
                    {t("deletePair")}
                  </Button>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {pairs.length < MAX_SECONDARY_BANNER_PAIRS && (
        <div>
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            onClick={() => run(() => createSecondaryPairAction(device))}
          >
            <PlusIcon aria-hidden />
            {t("addPair")}
          </Button>
        </div>
      )}

      {status && (
        <p role="status" className="text-sm text-muted-foreground">
          {status}
        </p>
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
