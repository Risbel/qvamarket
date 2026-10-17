import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Storefront brand colors by name (CSS variables set by the store layout), or any CSS color */
const NAMED_COLORS = {
  brand: "var(--brand)",
  accent: "var(--brand-accent)",
} as const;

type SpotlightColor = keyof typeof NAMED_COLORS | (string & {});

/**
 * Decorative layer for <Spotlight>s: covers its positioned parent (which needs `relative
 * isolate`, so the -z-10 stays behind the content), clips the glows so they never add a
 * scrollbar, and ignores the pointer. Size or move it with `className` (e.g. `h-[48rem]`).
 */
export function Spotlights({
  darkOnly = true,
  className,
  children,
}: {
  /** On a light background the glows only muddy it, so by default they are dark theme only */
  darkOnly?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-0 -z-10 overflow-hidden",
        darkOnly && "hidden dark:block",
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * One soft round glow (a radial gradient, not a blur filter, so it costs nothing while
 * scrolling). Place it inside <Spotlights> with position classes, e.g. `-top-56 -right-48`.
 */
export function Spotlight({
  color = "brand",
  size = "40rem",
  height,
  opacity = 0.3,
  core = 0,
  className,
}: {
  /** `brand`, `accent` or any CSS color */
  color?: SpotlightColor;
  /** Width (and height, unless `height` is given) as a CSS length */
  size?: string;
  /** Height as a CSS length, for an oval glow */
  height?: string;
  /** 0 to 1 */
  opacity?: number;
  /** Percentage of the radius that stays at full color before fading (0 = fades from the center) */
  core?: number;
  className?: string;
}) {
  const fill = color in NAMED_COLORS ? NAMED_COLORS[color as keyof typeof NAMED_COLORS] : color;
  const style: CSSProperties = {
    width: size,
    height: height ?? size,
    opacity,
    backgroundImage: `radial-gradient(closest-side, ${fill} ${core}%, transparent)`,
  };
  return <div className={cn("absolute rounded-full", className)} style={style} />;
}
