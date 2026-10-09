"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

/** Big image plus clickable thumbnails. `images` are public URLs, main image first. */
export function ProductGallery({ images, alt }: { images: string[]; alt: string }) {
  const t = useTranslations("Store.product");
  const [selected, setSelected] = useState(0);

  if (images.length === 0) {
    return (
      <div className="flex aspect-square items-center justify-center rounded-lg border bg-muted text-sm text-muted-foreground">
        {t("noImage")}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="aspect-square overflow-hidden rounded-lg border bg-muted">
        {/* eslint-disable-next-line @next/next/no-img-element -- our own bucket, already compressed */}
        <img
          src={images[selected]}
          alt={alt}
          width={800}
          height={800}
          className="size-full object-contain"
        />
      </div>
      {images.length > 1 && (
        <ul className="flex flex-wrap gap-2">
          {images.map((url, index) => (
            <li key={url}>
              <button
                type="button"
                onClick={() => setSelected(index)}
                aria-label={t("showImage", { number: index + 1 })}
                aria-current={index === selected}
                className={cn(
                  "size-16 overflow-hidden rounded-md border-2 bg-muted",
                  index === selected ? "border-foreground" : "border-transparent opacity-70 hover:opacity-100",
                )}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- our own bucket, already compressed */}
                <img src={url} alt="" width={64} height={64} className="size-full object-cover" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
