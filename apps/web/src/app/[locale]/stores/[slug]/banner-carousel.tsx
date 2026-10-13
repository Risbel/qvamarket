"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import Autoplay from "embla-carousel-autoplay";
import Fade from "embla-carousel-fade";
import { PauseIcon, PlayIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { BANNER_FORMATS, SECONDARY_BANNER_FORMATS, type BannerDevice } from "@/lib/images";
import { cn } from "@/lib/utils";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
  type CarouselApi,
} from "@/components/ui/carousel";

export type BannerSlide = { id: string; images: { id: string; url: string }[] };

/**
 * hero: one image per slide, with arrows, dots and a pause button.
 * secondary: a pair of tiles side by side per slide (both change together), no controls.
 */
export type BannerKind = "hero" | "secondary";

const AUTOPLAY_DELAY_MS = 5000;

// Each device's banner is only displayed on its screen size (breakpoint `md`, 48rem), at the
// shape its images were made for (BANNER_FORMATS / SECONDARY_BANNER_FORMATS), so a banner with
// text is never cropped to fit the other shape. `otherScreens` is where the banner is hidden:
// there each image is swapped for an inline 1x1 pixel through <picture>, because browsers
// download images inside display:none (even lazy ones), and a phone must not pay for the
// desktop banner. Literal class names: Tailwind only generates what it can read.
const DEVICES: Record<BannerDevice, { root: string; otherScreens: string }> = {
  desktop: { root: "hidden md:block", otherScreens: "not all and (min-width: 48rem)" },
  mobile: { root: "md:hidden", otherScreens: "(min-width: 48rem)" },
};
const ASPECTS: Record<BannerKind, Record<BannerDevice, string>> = {
  hero: { desktop: "aspect-[48/13]", mobile: "aspect-square" },
  secondary: { desktop: "aspect-[48/13]", mobile: "aspect-square" },
};
const FORMATS = { hero: BANNER_FORMATS, secondary: SECONDARY_BANNER_FORMATS };
const EMPTY_PIXEL = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";

/**
 * The autoplay plugin, if running. An inactive carousel (one slide: `active: false`) never
 * initializes its plugins, and then Embla's plugins() returns undefined despite its types.
 */
function autoplayOf(api: CarouselApi) {
  const plugins: ReturnType<NonNullable<CarouselApi>["plugins"]> | undefined = api?.plugins();
  return plugins?.autoplay;
}

/**
 * Storefront banner: slides fading into each other with autoplay. Autoplay starts only when
 * the visitor does not prefer reduced motion and stops for good when they swipe. One slide =
 * a static banner (no autoplay, no controls).
 */
export function BannerCarousel({
  slides,
  device,
  kind,
  storeName,
}: {
  slides: BannerSlide[];
  device: BannerDevice;
  kind: BannerKind;
  storeName: string;
}) {
  const t = useTranslations("Store.hero");
  const multiple = slides.length > 1;
  // Created once (lazy state); Embla re-initializes when the plugin list changes identity
  const [plugins] = useState(() =>
    multiple
      ? [Fade(), Autoplay({ delay: AUTOPLAY_DELAY_MS, playOnInit: false, stopOnInteraction: true, stopOnFocusIn: true })]
      : [],
  );
  const [api, setApi] = useState<CarouselApi>();

  useEffect(() => {
    const autoplay = autoplayOf(api);
    if (autoplay && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) autoplay.play();
  }, [api]);

  const format = FORMATS[kind][device];
  const imageClass = cn("w-full object-cover", ASPECTS[kind][device]);
  // The hero's first image is usually the page's largest paint; tiles sit lower on the page
  const priority = (slide: number) => kind === "hero" && slide === 0;

  return (
    <Carousel
      setApi={setApi}
      opts={{ loop: true, active: multiple }}
      plugins={plugins}
      aria-label={kind === "hero" ? t("label") : t("secondaryLabel")}
      className={cn(kind === "hero" && "overflow-hidden rounded-lg border bg-muted", DEVICES[device].root)}
    >
      <CarouselContent className="ml-0">
        {slides.map((slide, index) => (
          <CarouselItem
            key={slide.id}
            className="pl-0"
            aria-label={multiple ? t("slide", { index: index + 1, count: slides.length }) : undefined}
          >
            <div className={cn(kind === "secondary" && "grid grid-cols-2 gap-3")}>
              {slide.images.map((image) => (
                <picture
                  key={image.id}
                  className={cn(kind === "secondary" && "block overflow-hidden rounded-lg border bg-muted")}
                >
                  <source media={DEVICES[device].otherScreens} srcSet={EMPTY_PIXEL} />
                  <img
                    src={image.url}
                    alt={kind === "hero" && index === 0 ? storeName : ""}
                    width={format.width}
                    height={format.height}
                    loading={priority(index) ? "eager" : "lazy"}
                    fetchPriority={priority(index) ? "high" : "auto"}
                    draggable={false}
                    className={imageClass}
                  />
                </picture>
              ))}
            </div>
          </CarouselItem>
        ))}
      </CarouselContent>

      {kind === "hero" && multiple && <HeroControls api={api} count={slides.length} />}
    </Carousel>
  );
}

// Translucent round buttons on top of the image, readable on any photo in both themes
const overlayButton =
  "border-0 bg-background/70 text-foreground shadow-sm backdrop-blur hover:bg-background/90 dark:bg-background/60 dark:hover:bg-background/80";

/**
 * Arrows at mid-height, dots plus a pause/play button over the bottom center (moving content
 * needs a way to stop it). Arrows and dots only restart the autoplay timer.
 */
function HeroControls({ api, count }: { api: CarouselApi; count: number }) {
  const t = useTranslations("Store.hero");

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
    () => autoplayOf(api)?.isPlaying() ?? false,
    () => false,
  );

  // Clicking an arrow or a dot moves on by itself: give the new image a full delay
  const restartTimer = () => autoplayOf(api)?.reset();

  function togglePlaying() {
    const autoplay = autoplayOf(api);
    if (!autoplay) return;
    if (autoplay.isPlaying()) autoplay.stop();
    else autoplay.play();
  }

  return (
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
          {Array.from({ length: count }, (_, index) => (
            <button
              key={index}
              type="button"
              aria-label={t("slide", { index: index + 1, count })}
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
  );
}
