"use client";

import { useStoreId } from "@/components/panel-scope";
import { useEffect, useState } from "react";
import { useController, useFormState, type UseFormReturn } from "react-hook-form";
import { ImageUpIcon, Loader2Icon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { compressForUpload } from "@/lib/compress-image";
import {
  formatBytes,
  IMAGE_TYPES,
  MAX_IMAGE_BYTES,
  MAX_IMAGES_PER_PRODUCT,
  MAX_ORIGINAL_BYTES,
} from "@/lib/images";
import { useHydrated } from "@/lib/use-hydrated";
import type { ImageRef, ProductFormValues } from "@/lib/validation/product";
import { discardProductUploadAction, stageProductImageAction } from "@/server/product-image-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dropzone, DropzoneDescription, DropzoneIcon, DropzoneTitle } from "@/components/ui/dropzone";
import { FieldError } from "@/components/ui/field";

/** An error about one picked file (or about the whole pick when `name` is empty) */
type Line = { name: string; text: string };
/** A picked file still being compressed or uploaded */
type Pending = { key: string; name: string; previewUrl: string };

/**
 * The product's images inside the product form (field `images`). Picking files uploads them
 * right away as staged uploads; removing, "make main" and new images only change the form
 * value, which the product's Save applies as a whole (server/product-images.ts).
 */
export function ProductImagesField({
  form,
  productName,
  savedUrls,
  onBusyChange,
}: {
  form: UseFormReturn<ProductFormValues>;
  productName: string;
  /** url of each saved image, by id */
  savedUrls: Record<string, string>;
  /** true while files are being uploaded (the form waits for them before saving) */
  onBusyChange: (busy: boolean) => void;
}) {
  const storeId = useStoreId();
  const t = useTranslations("Products.images");
  const locale = useLocale();
  const hydrated = useHydrated();
  const { field, fieldState } = useController({ control: form.control, name: "images" });
  const { dirtyFields, isSubmitted } = useFormState({ control: form.control, name: "images" });
  const [urls, setUrls] = useState<Record<string, string>>(savedUrls);
  const [pending, setPending] = useState<Pending[]>([]);
  const [lines, setLines] = useState<Line[]>([]);

  const images = field.value;
  const busy = pending.length > 0;
  const remaining = MAX_IMAGES_PER_PRODUCT - images.length - pending.length;

  // Several drops can upload at once: the form waits until none is left
  useEffect(() => onBusyChange(busy), [busy, onBusyChange]);

  // The upload loop awaits between files, so it reads the current value from the form
  const update = (next: ImageRef[]) => {
    form.setValue("images", next, { shouldDirty: true, shouldValidate: isSubmitted });
  };

  async function onFiles(files: File[]) {
    if (files.length === 0) return;
    setLines([]);
    if (files.length > remaining) {
      setLines([{ name: "", text: t("tooMany", { count: remaining }) }]);
      return;
    }

    const queued = files.map((file) => ({
      file,
      key: crypto.randomUUID(),
      name: file.name,
      previewUrl: URL.createObjectURL(file),
    }));
    setPending((current) => [...current, ...queued]);

    const errors: Line[] = [];
    for (const item of queued) {
      const error = await upload(item.file);
      if (error) errors.push(error);
      URL.revokeObjectURL(item.previewUrl);
      setPending((current) => current.filter((entry) => entry.key !== item.key));
    }
    setLines(errors);
  }

  /** Compresses and stages one file and appends it to the images; returns the error, if any */
  async function upload(file: File): Promise<Line | null> {
    let compressed: Awaited<ReturnType<typeof compressForUpload>>;
    try {
      compressed = await compressForUpload(file);
    } catch {
      // the browser could not decode the file (corrupt, or not really an image)
      return { name: file.name, text: t("errors.unreadable") };
    }
    if (!compressed.ok) {
      return {
        name: file.name,
        text: t(`errors.${compressed.error}`, {
          max: formatBytes(MAX_ORIGINAL_BYTES, locale),
          limit: formatBytes(MAX_IMAGE_BYTES, locale),
        }),
      };
    }

    try {
      const body = new FormData();
      body.append("file", compressed.file, compressed.file.type === "image/jpeg" ? "image.jpg" : "image.webp");
      const result = await stageProductImageAction(storeId, body);
      if (!result.ok) return { name: file.name, text: t(`errors.${result.error}`) };
      setUrls((current) => ({ ...current, [result.uploadId]: result.url }));
      update([...form.getValues("images"), { kind: "upload", id: result.uploadId }]);
      return null;
    } catch {
      // e.g. the request was rejected before reaching the action (body too large)
      return { name: file.name, text: t("errors.failed") };
    }
  }

  function makeMain(id: string) {
    const image = images.find((ref) => ref.id === id);
    if (image) update([image, ...images.filter((ref) => ref.id !== id)]);
  }

  function remove(ref: ImageRef) {
    update(images.filter((other) => other.id !== ref.id));
    // A saved image is only removed by Save; an unsaved upload can go right away
    if (ref.kind === "upload") void discardProductUploadAction(storeId, ref.id).catch(() => {});
  }

  return (
    <section className="flex flex-col gap-3" aria-labelledby="images-title">
      <div>
        <h2 id="images-title" className="text-base font-semibold">
          {t("title")}{" "}
          <span className="text-sm font-normal text-muted-foreground">
            {t("count", { count: images.length, max: MAX_IMAGES_PER_PRODUCT })}
          </span>
        </h2>
        <p className="text-sm text-muted-foreground">
          {t("help", { limit: formatBytes(MAX_IMAGE_BYTES, locale) })}
        </p>
      </div>

      {images.length === 0 && pending.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {images.map((image, index) => (
            <li key={image.id} className="flex flex-col gap-2 rounded-lg border p-2">
              <div className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element -- files come from our own S3 bucket and are already compressed */}
                <img
                  src={urls[image.id]}
                  alt={productName}
                  width={240}
                  height={240}
                  loading="lazy"
                  className="aspect-square w-full rounded-md object-cover"
                />
                {index === 0 && <Badge className="absolute left-2 top-2">{t("main")}</Badge>}
                {image.kind === "upload" && (
                  <Badge variant="secondary" className="absolute right-2 top-2">
                    {t("new")}
                  </Badge>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {index !== 0 && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={!hydrated}
                    onClick={() => makeMain(image.id)}
                  >
                    {t("makeMain")}
                  </Button>
                )}
                <Button type="button" size="sm" variant="outline" disabled={!hydrated} onClick={() => remove(image)}>
                  {t("remove")}
                </Button>
              </div>
            </li>
          ))}
          {pending.map((item) => (
            <li key={item.key} className="flex flex-col gap-2 rounded-lg border p-2">
              <div className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element -- local preview (object URL) of the picked file */}
                <img
                  src={item.previewUrl}
                  alt=""
                  width={240}
                  height={240}
                  className="aspect-square w-full rounded-md object-cover opacity-50"
                />
                <div className="absolute inset-0 flex items-center justify-center">
                  <Loader2Icon className="size-6 animate-spin" aria-hidden />
                </div>
              </div>
              <p role="status" className="truncate text-xs text-muted-foreground">
                {t("uploading", { name: item.name })}
              </p>
            </li>
          ))}
        </ul>
      )}

      {remaining > 0 && (
        <Dropzone
          accept={IMAGE_TYPES}
          multiple
          disabled={!hydrated}
          aria-invalid={fieldState.invalid || undefined}
          inputProps={{ "aria-label": t("add") }}
          onFiles={onFiles}
          onReject={(files) =>
            setLines(files.map((file) => ({ name: file.name, text: t("errors.unsupportedType") })))
          }
        >
          <DropzoneIcon>
            <ImageUpIcon aria-hidden />
          </DropzoneIcon>
          <DropzoneTitle>{t("dropTitle")}</DropzoneTitle>
          <DropzoneDescription>{t("dropDescription", { count: remaining })}</DropzoneDescription>
        </Dropzone>
      )}
      {(dirtyFields.images || busy) && (
        <p className="text-sm text-muted-foreground">{t("pendingSave")}</p>
      )}

      {lines.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm text-destructive" aria-live="polite">
          {lines.map((line, i) => (
            <li key={i}>
              {line.name && <span className="font-medium">{line.name}: </span>}
              {line.text}
            </li>
          ))}
        </ul>
      )}
      <FieldError errors={[fieldState.error]} />
    </section>
  );
}
