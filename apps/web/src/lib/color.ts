// Brand colors are stored as lowercase #rrggbb (enforced by a CHECK on the store table).

export const HEX_COLOR = /^#[0-9a-f]{6}$/;
export const DEFAULT_PRIMARY = "#171717";
export const DEFAULT_ACCENT = "#6366f1";

function channel(value: number) {
  const s = value / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of a #rrggbb color (0 = black, 1 = white). */
export function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  return (
    0.2126 * channel((n >> 16) & 255) +
    0.7152 * channel((n >> 8) & 255) +
    0.0722 * channel(n & 255)
  );
}

export function contrastRatio(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

/**
 * Black or white, whichever reads better on `background`. The worst case (a mid grey,
 * relative luminance ~0.18) still reaches ~4.6:1, so the result always meets WCAG AA (4.5:1)
 * for normal text: no brand color can produce unreadable text with this rule.
 */
export function readableForeground(background: string): "#000000" | "#ffffff" {
  return contrastRatio(background, "#ffffff") >= contrastRatio(background, "#000000")
    ? "#ffffff"
    : "#000000";
}
