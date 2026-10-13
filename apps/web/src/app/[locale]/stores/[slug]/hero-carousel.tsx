"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import Autoplay from "embla-carousel-autoplay";
import Fade from "embla-carousel-fade";
import { PauseIcon, PlayIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
  type CarouselApi,
} from "@/components/ui/carousel";

export type HeroImage = { id: string; url: string };

const AUTOPLAY_DELAY_MS = 5000;

// Translucent round buttons on top of the image, readable on any photo in both themes
const overlayButton =
  "border-0 bg-background/70 text-foreground shadow-sm backdrop-blur hover:bg-background/90 dark:bg-background/60 dark:hover:bg-background/80";

/**
 * Storefront hero: the store's banner images, fading into each other with autoplay.
 * Autoplay starts only when the visitor does not prefer reduced motion, stops for good when
 * they swipe, and the pause/play button is always theirs to use (moving content needs a way
 * to stop it). Arrows and dots only restart the timer. One image = a static banner.
 */
export function HeroCarousel({ images, storeName }: { images: HeroImage[]; storeName: string }) {
  const t = useTranslations("Store.hero");
  const multiple = images.length > 1;
  // Created once (lazy state); Embla re-initializes when the plugin list changes identity
  const [plugins] = useState(() =>
    multiple
      ? [Fade(), Autoplay({ delay: AUTOPLAY_DELAY_MS, playOnInit: false, stopOnInteraction: true, stopOnFocusIn: true })]
      : [],
  );
  const [api, setApi] = useState<CarouselApi>();

  // Embla is the source of truth: read the current image and the autoplay state from it
  const subscribeSelect = useCallback(
    (onChange: () => void) => {
      if (!api) return () => {};
      api.on("select", onChange).on("reInit", onChange);
      return () => {
        api.off("select", onChange).off("reInit", onChange);
      };
    },
    [api],
  );
  // The plugin emits play/stop just BEFORE isPlaying() changes: read it a tick later
  const subscribeAutoplay = useCallback(
    (onChange: () => void) => {
      if (!api) return () => {};
      const later = () => queueMicrotask(onChange);
      api.on("autoplay:play", later).on("autoplay:stop", later);
      return () => {
        api.off("autoplay:play", later).off("autoplay:stop", later);
      };
    },
    [api],
  );
  const selected = useSyncExternalStore(subscribeSelect, () => api?.selectedScrollSnap() ?? 0, () => 0);
  const playing = useSyncExternalStore(
    subscribeAutoplay,
    () => api?.plugins().autoplay?.isPlaying() ?? false,
    () => false,
  );

  useEffect(() => {
    const autoplay = api?.plugins().autoplay;
    if (autoplay && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) autoplay.play();
  }, [api]);

  // Clicking an arrow or a dot moves on by itself: give the new image a full delay
  const restartTimer = () => api?.plugins().autoplay?.reset();

  function togglePlaying() {
    const autoplay = api?.plugins().autoplay;
    if (!autoplay) return;
    if (autoplay.isPlaying()) autoplay.stop();
    else autoplay.play();
  }

  return (
    <Carousel
      setApi={setApi}
      opts={{ loop: true, active: multiple }}
      plugins={plugins}
      aria-label={t("label")}
      className="overflow-hidden rounded-lg border bg-muted"
    >
      <CarouselContent className="ml-0">
        {images.map((image, index) => (
          <CarouselItem
            key={image.id}
            className="pl-0"
            aria-label={multiple ? t("slide", { index: index + 1, count: images.length }) : undefined}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- our own bucket, already compressed */}
            <img
              src={image.url}
              alt={index === 0 ? storeName : ""}
              width={2048}
              height={1024}
              // The first image is usually the page's largest paint
              loading={index === 0 ? "eager" : "lazy"}
              fetchPriority={index === 0 ? "high" : "auto"}
              draggable={false}
              className="aspect-[2/1] w-full object-cover"
            />
          </CarouselItem>
        ))}
      </CarouselContent>

      {multiple && (
        <>
          <CarouselPrevious
            size="icon-lg"
            aria-label={t("previous")}
            onClickCapture={restartTimer}
            className={cn("left-2 sm:left-3", overlayButton)}
          />
          <CarouselNext
            size="icon-lg"
            aria-label={t("next")}
            onClickCapture={restartTimer}
            className={cn("right-2 sm:right-3", overlayButton)}
          />
          <div className="absolute inset-x-0 bottom-2 flex items-center justify-center gap-1 sm:bottom-3">
            <div className="flex items-center gap-0.5 rounded-full bg-background/60 px-1.5 py-0.5 backdrop-blur">
              {images.map((image, index) => (
                <button
                  key={image.id}
                  type="button"
                  aria-label={t("slide", { index: index + 1, count: images.length })}
                  aria-current={index === selected ? "true" : undefined}
                  onClick={() => {
                    api?.scrollTo(index);
                    restartTimer();
                  }}
                  // 24 px tap target around a small dot
                  className="group flex size-6 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span
                    className={cn(
                      "block size-2 rounded-full bg-foreground/40 transition-all group-hover:bg-foreground/70",
                      index === selected && "w-4 bg-foreground group-hover:bg-foreground",
                    )}
                  />
                </button>
              ))}
              <button
                type="button"
                aria-label={playing ? t("pause") : t("play")}
                onClick={togglePlaying}
                className="flex size-6 items-center justify-center rounded-full text-foreground/80 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                {playing ? <PauseIcon className="size-3.5" aria-hidden /> : <PlayIcon className="size-3.5" aria-hidden />}
              </button>
            </div>
          </div>
        </>
      )}
    </Carousel>
  );
}
