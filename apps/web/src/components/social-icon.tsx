import type { CSSProperties } from "react";
import { socialIconUrl, type SocialNetwork } from "@/lib/social";
import { cn } from "@/lib/utils";

/**
 * Outlined icon of a social network (Tabler Icons, static file in public/icons/social/).
 * Drawn as a CSS mask filled with currentColor, not an <img>: an image SVG cannot take the
 * text color, a mask can, so the icon follows the theme and hover colors. Decorative: the
 * link or label around it carries the name.
 */
export function SocialIcon({ network, className }: { network: SocialNetwork; className?: string }) {
  const mask = `url(${socialIconUrl(network)}) center / contain no-repeat`;
  return (
    <span
      aria-hidden
      className={cn("inline-block size-5 shrink-0 bg-current", className)}
      style={{ mask, WebkitMask: mask } as CSSProperties}
    />
  );
}
