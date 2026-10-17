"use client";

import { useRef } from "react";
import { Badge } from "@/components/ui/badge";
import { holdBars, useHideOnScroll } from "./use-hide-on-scroll";

/**
 * Index of the catalog's categories, pinned right under the store header (and the phone
 * search row, following --store-sticky). Like that row, it slides away while the shopper
 * scrolls down and comes back on any scroll up. Plain anchors: it works without JS too.
 */
export function CategoryIndex({
  label,
  sections,
}: {
  label: string;
  sections: { id: string; title: string }[];
}) {
  const nav = useRef<HTMLElement>(null);
  const hidden = useHideOnScroll(nav);

  return (
    <nav
      ref={nav}
      aria-label={label}
      // Behind the header and the search row (z-20 < z-30 < z-40): hiding slides it up under
      // them. `invisible` takes the links out of the tab order while it is away.
      className={`sticky top-(--store-sticky) z-20 h-(--store-index) border-b bg-background/60 backdrop-blur transition-[top,translate,opacity,visibility] duration-200 ${
        hidden ? "invisible -translate-y-full opacity-0" : ""
      }`}
    >
      <div className="mx-auto flex h-full w-full max-w-5xl items-center gap-2 overflow-x-auto px-4">
        {sections.map((section) => (
          <Badge
            key={section.id}
            variant="secondary"
            render={<a href={`#${section.id}`} onClick={() => holdBars()} />}
            className="h-7 px-3 text-sm"
          >
            {section.title}
          </Badge>
        ))}
      </div>
    </nav>
  );
}
