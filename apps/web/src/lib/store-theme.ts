import type { CSSProperties } from "react";
import type {
  THEME_BASES as DB_THEME_BASES,
  THEME_RADII as DB_THEME_RADII,
} from "@qvashop/db/schema";
import { DEFAULT_ACCENT, DEFAULT_PRIMARY, readableForeground } from "./color";

// The storefront theme: the shadcn tokens (--background ... --sidebar-ring, --radius) of a
// store, light and dark, generated from a few choices made in Settings > Branding. Only the
// choices are stored (store.primary_color, accent_color, theme_radius, theme_base,
// theme_tinted); everything here is derived, so a theme can never hold arbitrary CSS.
// Pure and client-safe: the branding preview builds the same theme in the browser.

/** Corner radius presets, in rem (`--radius`) */
export const THEME_RADII = ["0", "0.3", "0.5", "0.625", "0.75", "1"] as const satisfies typeof DB_THEME_RADII;
export type ThemeRadius = (typeof THEME_RADII)[number];
export const DEFAULT_THEME_RADIUS: ThemeRadius = "0.625";

/** shadcn base grays (background, cards, borders, muted text) */
export const THEME_BASES = ["neutral", "stone", "zinc", "gray", "slate"] as const satisfies typeof DB_THEME_BASES;
export type ThemeBase = (typeof THEME_BASES)[number];
export const DEFAULT_THEME_BASE: ThemeBase = "neutral";

export const isThemeRadius = (value: unknown): value is ThemeRadius =>
  (THEME_RADII as readonly unknown[]).includes(value);
export const isThemeBase = (value: unknown): value is ThemeBase =>
  (THEME_BASES as readonly unknown[]).includes(value);

/**
 * One base gray, as in shadcn's theming docs. `ink` is the light theme's text and the dark
 * theme's page, `deep` the light theme's dark tone and the dark theme's cards, `white` the
 * dark theme's text and the light theme's sidebar; `surface` = secondary / muted / accent.
 */
type BasePalette = {
  ink: string;
  deep: string;
  white: string;
  light: { surface: string; mutedForeground: string; border: string; ring: string };
  dark: { surface: string; mutedForeground: string; ring: string };
};

const BASE_PALETTES: Record<ThemeBase, BasePalette> = {
  neutral: {
    ink: "oklch(0.145 0 0)",
    deep: "oklch(0.205 0 0)",
    white: "oklch(0.985 0 0)",
    light: {
      surface: "oklch(0.97 0 0)",
      mutedForeground: "oklch(0.556 0 0)",
      border: "oklch(0.922 0 0)",
      ring: "oklch(0.708 0 0)",
    },
    dark: { surface: "oklch(0.269 0 0)", mutedForeground: "oklch(0.708 0 0)", ring: "oklch(0.556 0 0)" },
  },
  stone: {
    ink: "oklch(0.147 0.004 49.25)",
    deep: "oklch(0.216 0.006 56.043)",
    white: "oklch(0.985 0.001 106.423)",
    light: {
      surface: "oklch(0.97 0.001 106.424)",
      mutedForeground: "oklch(0.553 0.013 58.071)",
      border: "oklch(0.923 0.003 48.717)",
      ring: "oklch(0.709 0.01 56.259)",
    },
    dark: {
      surface: "oklch(0.268 0.007 34.298)",
      mutedForeground: "oklch(0.709 0.01 56.259)",
      ring: "oklch(0.553 0.013 58.071)",
    },
  },
  zinc: {
    ink: "oklch(0.141 0.005 285.823)",
    deep: "oklch(0.21 0.006 285.885)",
    white: "oklch(0.985 0 0)",
    light: {
      surface: "oklch(0.967 0.001 286.375)",
      mutedForeground: "oklch(0.552 0.016 285.938)",
      border: "oklch(0.92 0.004 286.32)",
      ring: "oklch(0.705 0.015 286.067)",
    },
    dark: {
      surface: "oklch(0.274 0.006 286.033)",
      mutedForeground: "oklch(0.705 0.015 286.067)",
      ring: "oklch(0.552 0.016 285.938)",
    },
  },
  gray: {
    ink: "oklch(0.13 0.028 261.692)",
    deep: "oklch(0.21 0.034 264.665)",
    white: "oklch(0.985 0.002 247.839)",
    light: {
      surface: "oklch(0.967 0.003 264.542)",
      mutedForeground: "oklch(0.551 0.027 264.364)",
      border: "oklch(0.928 0.006 264.531)",
      ring: "oklch(0.707 0.022 261.325)",
    },
    dark: {
      surface: "oklch(0.278 0.033 256.848)",
      mutedForeground: "oklch(0.707 0.022 261.325)",
      ring: "oklch(0.551 0.027 264.364)",
    },
  },
  slate: {
    ink: "oklch(0.129 0.042 264.695)",
    deep: "oklch(0.208 0.042 265.755)",
    white: "oklch(0.984 0.003 247.858)",
    light: {
      surface: "oklch(0.968 0.007 247.896)",
      mutedForeground: "oklch(0.554 0.046 257.417)",
      border: "oklch(0.929 0.013 255.508)",
      ring: "oklch(0.704 0.04 256.788)",
    },
    dark: {
      surface: "oklch(0.279 0.041 260.031)",
      mutedForeground: "oklch(0.704 0.04 256.788)",
      ring: "oklch(0.551 0.027 264.364)",
    },
  },
};

/** A few tones of a base gray, for the swatches of the base picker */
export function baseSwatches(base: ThemeBase): string[] {
  const p = BASE_PALETTES[base];
  return [p.light.surface, p.light.border, p.light.mutedForeground, p.deep];
}

// --- Color math (OKLab / OKLCH, https://bottosson.github.io/posts/oklab/) -----------------

export type Oklch = { l: number; c: number; h: number };

const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const toGamma = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);

/** #rrggbb -> OKLCH (l 0..1, c >= 0, h in degrees) */
export function hexToOklch(hex: string): Oklch {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = toLinear(((n >> 16) & 255) / 255);
  const g = toLinear(((n >> 8) & 255) / 255);
  const b = toLinear((n & 255) / 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const c = Math.hypot(A, B);
  const h = c < 1e-4 ? 0 : ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360;
  return { l: L, c, h };
}

/** OKLCH -> linear sRGB, possibly out of the 0..1 gamut */
function oklchToLinearRgb({ l: L, c, h }: Oklch): [number, number, number] {
  const A = c * Math.cos((h * Math.PI) / 180);
  const B = c * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const inGamut = (rgb: number[]) => rgb.every((v) => v >= -1e-4 && v <= 1 + 1e-4);

/** OKLCH -> #rrggbb; out-of-gamut colors keep lightness and hue and lose chroma */
export function oklchToHex(color: Oklch): string {
  let rgb = oklchToLinearRgb(color);
  if (!inGamut(rgb)) {
    let [low, high] = [0, color.c];
    for (let i = 0; i < 24; i++) {
      const mid = (low + high) / 2;
      if (inGamut(oklchToLinearRgb({ ...color, c: mid }))) low = mid;
      else high = mid;
    }
    rgb = oklchToLinearRgb({ ...color, c: low });
  }
  return `#${rgb
    .map((v) => Math.round(toGamma(Math.min(1, Math.max(0, v))) * 255).toString(16).padStart(2, "0"))
    .join("")}`;
}

const css = ({ l, c, h }: Oklch) => `oklch(${l.toFixed(3)} ${c.toFixed(3)} ${h.toFixed(3)})`;

// --- Theme --------------------------------------------------------------------------------

export type StoreThemeInput = {
  primary?: string | null;
  accent?: string | null;
  radius?: string | null;
  base?: string | null;
  tinted?: boolean | null;
};

export type ThemeVars = Record<`--${string}`, string>;
export type StoreTheme = { light: ThemeVars; dark: ThemeVars };

/**
 * The primary for dark pages: very dark colors (the default near-black) would vanish on a
 * dark page, so they turn light, like shadcn's own dark primary; other colors only lose a
 * little lightness so they do not glare (as in shadcn's color themes).
 */
export function darkPrimary(hex: string): string {
  const color = hexToOklch(hex);
  const l = color.l < 0.35 ? 0.92 : Math.max(0.4, color.l - 0.06);
  return oklchToHex({ ...color, l, c: color.l < 0.35 ? Math.min(color.c, 0.05) : color.c });
}

/**
 * Every token a store overrides, light and dark. Text on the primary and accent colors is
 * black or white (`readableForeground`), so no choice can produce unreadable text.
 * `--brand` / `--brand-accent` stay the merchant's exact colors in both themes (the header
 * and the logotype drawn for it); shadcn's `--primary` is adjusted for dark pages.
 */
export function buildStoreTheme(input: StoreThemeInput): StoreTheme {
  const primary = input.primary ?? DEFAULT_PRIMARY;
  const accent = input.accent ?? DEFAULT_ACCENT;
  const radius = isThemeRadius(input.radius) ? input.radius : DEFAULT_THEME_RADIUS;
  const p = BASE_PALETTES[isThemeBase(input.base) ? input.base : DEFAULT_THEME_BASE];
  const primaryDark = darkPrimary(primary);
  const hue = hexToOklch(primary);

  // Tinted: the gray surfaces (hover, secondary buttons, muted blocks) and the focus ring take
  // the primary's hue; an achromatic primary keeps them gray.
  const tint = (l: number, c: number) => css({ l, c: Math.min(c, hue.c), h: hue.h });
  const surface = input.tinted
    ? { light: tint(0.967, 0.014), dark: tint(0.274, 0.022) }
    : { light: p.light.surface, dark: p.dark.surface };
  const ring = input.tinted
    ? { light: tint(0.708, 0.1), dark: tint(0.556, 0.1) }
    : { light: p.light.ring, dark: p.dark.ring };

  const brand = {
    "--brand": primary,
    "--brand-foreground": readableForeground(primary),
    "--brand-accent": accent,
    "--brand-accent-foreground": readableForeground(accent),
  };

  const light: ThemeVars = {
    ...brand,
    "--radius": `${radius}rem`,
    "--background": "oklch(1 0 0)",
    "--foreground": p.ink,
    "--card": "oklch(1 0 0)",
    "--card-foreground": p.ink,
    "--popover": "oklch(1 0 0)",
    "--popover-foreground": p.ink,
    "--primary": primary,
    "--primary-foreground": readableForeground(primary),
    "--secondary": surface.light,
    "--secondary-foreground": p.deep,
    "--muted": surface.light,
    "--muted-foreground": p.light.mutedForeground,
    "--accent": surface.light,
    "--accent-foreground": p.deep,
    "--border": p.light.border,
    "--input": p.light.border,
    "--ring": ring.light,
    "--sidebar": p.white,
    "--sidebar-foreground": p.ink,
    "--sidebar-primary": primary,
    "--sidebar-primary-foreground": readableForeground(primary),
    "--sidebar-accent": surface.light,
    "--sidebar-accent-foreground": p.deep,
    "--sidebar-border": p.light.border,
    "--sidebar-ring": ring.light,
  };

  const dark: ThemeVars = {
    ...brand,
    "--radius": `${radius}rem`,
    "--background": p.ink,
    "--foreground": p.white,
    "--card": p.deep,
    "--card-foreground": p.white,
    "--popover": p.deep,
    "--popover-foreground": p.white,
    "--primary": primaryDark,
    "--primary-foreground": readableForeground(primaryDark),
    "--secondary": surface.dark,
    "--secondary-foreground": p.white,
    "--muted": surface.dark,
    "--muted-foreground": p.dark.mutedForeground,
    "--accent": surface.dark,
    "--accent-foreground": p.white,
    "--border": "oklch(1 0 0 / 10%)",
    "--input": "oklch(1 0 0 / 15%)",
    "--ring": ring.dark,
    "--sidebar": p.deep,
    "--sidebar-foreground": p.white,
    "--sidebar-primary": primaryDark,
    "--sidebar-primary-foreground": readableForeground(primaryDark),
    "--sidebar-accent": surface.dark,
    "--sidebar-accent-foreground": p.white,
    "--sidebar-border": "oklch(1 0 0 / 10%)",
    "--sidebar-ring": ring.dark,
  };

  return { light, dark };
}

const declarations = (vars: ThemeVars) =>
  Object.entries(vars)
    .map(([name, value]) => `${name}:${value};`)
    .join("");

/**
 * The theme as a stylesheet for a whole page. `:root:root` outranks globals.css's `:root` and
 * `.dark` whatever the load order, and `:root:root.dark` outranks both. Values only come from
 * the constants and numbers above (colors were validated as #rrggbb), never merchant text.
 */
export function storeThemeCss(theme: StoreTheme): string {
  return `:root:root{${declarations(theme.light)}}:root:root.dark{${declarations(theme.dark)}}`;
}

/** The same variables as an inline style, to dress a single element (the branding preview) */
export const themeStyle = (vars: ThemeVars) => vars as CSSProperties;
