"use client";

import { useState, type KeyboardEvent } from "react";
import { ChevronLeftIcon, ChevronRightIcon, Maximize2Icon, XIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

/** Round controls floating over the enlarged image */
const overImage = "absolute rounded-full shadow-sm";

/**
 * Big image plus clickable thumbnails. `images` are public URLs, main image first.
 * The big image opens a full-screen view (dialog: focus trap, Esc and the backdrop close it).
 */
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

  const many = images.length > 1;
  const step = (delta: number) => setSelected((index) => (index + delta + images.length) % images.length);

  function onKeyDown(event: KeyboardEvent) {
    if (!many) return;
    if (event.key === "ArrowLeft") step(-1);
    else if (event.key === "ArrowRight") step(1);
  }

  return (
    <div className="flex flex-col gap-3">
      <Dialog>
        <DialogTrigger
          aria-label={t("zoom")}
          className="group relative aspect-square cursor-zoom-in overflow-hidden rounded-lg border bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- our own bucket, already compressed */}
          <img src={images[selected]} alt={alt} width={800} height={800} className="size-full object-contain" />
          <span
            aria-hidden
            className="absolute right-3 bottom-3 flex size-9 items-center justify-center rounded-full bg-background/85 text-foreground shadow-sm backdrop-blur transition-transform group-hover:scale-110"
          >
            <Maximize2Icon className="size-4" />
          </span>
        </DialogTrigger>
        <DialogContent
          showCloseButton={false}
          onKeyDown={onKeyDown}
          overlayClassName="bg-black/80"
          className="w-auto max-w-none bg-transparent p-0 ring-0 sm:max-w-none"
        >
          <DialogTitle className="sr-only">{alt}</DialogTitle>
          {/* eslint-disable-next-line @next/next/no-img-element -- our own bucket, already compressed */}
          <img src={images[selected]} alt={alt} className="max-h-[calc(100dvh-2rem)] max-w-[calc(100vw-2rem)] rounded-lg object-contain" />
          <DialogClose
            aria-label={t("closeZoom")}
            render={<Button variant="secondary" size="icon-lg" className={cn(overImage, "top-2 right-2")} />}
          >
            <XIcon aria-hidden />
          </DialogClose>
          {many && (
            <>
              <Button
                type="button"
                variant="secondary"
                size="icon-lg"
                onClick={() => step(-1)}
                aria-label={t("previousImage")}
                className={cn(overImage, "top-1/2 left-2 -translate-y-1/2")}
              >
                <ChevronLeftIcon aria-hidden />
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="icon-lg"
                onClick={() => step(1)}
                aria-label={t("nextImage")}
                className={cn(overImage, "top-1/2 right-2 -translate-y-1/2")}
              >
                <ChevronRightIcon aria-hidden />
              </Button>
              <Badge variant="secondary" className="absolute bottom-2 left-1/2 h-6 -translate-x-1/2 px-3 tabular-nums shadow-sm">
                {t("imageCount", { number: selected + 1, total: images.length })}
              </Badge>
            </>
          )}
        </DialogContent>
      </Dialog>
      {many && (
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
