import { z } from "zod";
import { HEX_COLOR } from "@/lib/color";
import { THEME_BASES, THEME_RADII } from "@/lib/store-theme";
import type { Translator } from "./types";

export function createBrandingSchema(t: Translator) {
  const color = z.string().trim().toLowerCase().regex(HEX_COLOR, t("colorInvalid"));
  return z.object({
    primaryColor: color,
    accentColor: color,
    radius: z.enum(THEME_RADII),
    base: z.enum(THEME_BASES),
    tinted: z.boolean(),
  });
}

export type BrandingValues = z.infer<ReturnType<typeof createBrandingSchema>>;
