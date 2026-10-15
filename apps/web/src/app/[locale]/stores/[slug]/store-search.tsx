"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { usePathname } from "@/i18n/navigation";
import { SearchAutocomplete } from "./search-autocomplete";

/** Storefront pages without the search: the checkout stays free of distractions. */
const NO_SEARCH = ["/checkout"];

function useShowSearch() {
  const pathname = usePathname();
  return !NO_SEARCH.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

/** The field; on the results page it shows the current query, elsewhere it starts empty. */
function SearchForm({ storeName, className }: { storeName: string; className?: string }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = pathname === "/search" ? (searchParams.get("q") ?? "") : "";
  // A new page or query starts a fresh field (typed text and suggestions are dropped)
  return <SearchAutocomplete key={`${pathname}?${query}`} initialQuery={query} storeName={storeName} className={className} />;
}

/** Desktop (md and up): the field sits inside the main bar, which has room for it. */
export function HeaderSearch({ storeName }: { storeName: string }) {
  if (!useShowSearch()) return null;
  return <SearchForm storeName={storeName} className="mx-auto hidden max-w-md flex-1 md:block" />;
}

/** How far (px) the page must scroll in one direction before the row hides or comes back. */
const SCROLL_TOLERANCE = 8;

/**
 * Phones: a second row under the main bar, with the same brand background. It slides away
 * while the shopper scrolls down (more room for products) and comes back as soon as they
 * scroll up, so it is always one small gesture away. The main bar (logo, cart, account)
 * never moves. While hidden, the wrapper's --store-sticky drops to the main bar's height
 * (see the store layout), so the catalog's category index moves up with it.
 */
export function MobileSearchRow({ storeName }: { storeName: string }) {
  const show = useShowSearch();
  const [hidden, setHidden] = useState(false);
  const row = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!show) return;
    let last = window.scrollY;
    let frame = 0;
    const update = () => {
      frame = 0;
      const y = Math.max(window.scrollY, 0); // iOS bounces below 0
      const height = row.current?.offsetHeight ?? 0;
      if (y <= height) setHidden(false); // back at the top: always shown
      else if (row.current?.contains(document.activeElement)) setHidden(false); // typing
      else if (y - last > SCROLL_TOLERANCE) setHidden(true);
      else if (last - y > SCROLL_TOLERANCE) setHidden(false);
      else return; // small moves keep the anchor point, so slow scrolls still count
      last = y;
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, [show]);

  if (!show) return null;
  return (
    <div
      ref={row}
      data-search-hidden={hidden || undefined}
      // Behind the main bar (z-30 < z-40): hiding slides it up under it. `invisible` takes the
      // field out of the tab order and the accessibility tree while it is away.
      className={`sticky top-(--store-header) z-30 h-(--store-search) bg-(--brand)/80 px-4 backdrop-blur-md backdrop-saturate-150 transition-[translate,opacity,visibility] duration-200 md:hidden ${
        hidden ? "invisible -translate-y-full opacity-0" : ""
      }`}
      style={{ color: "var(--brand-foreground)" }}
    >
      <SearchForm storeName={storeName} className="pt-1" />
    </div>
  );
}
