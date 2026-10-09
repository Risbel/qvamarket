import { z } from "zod";
import { HEX_COLOR } from "@/lib/color";
import type { Translator } from "./types";

export function createBrandingSchema(t: Translator) {
  const color = z.string().trim().toLowerCase().regex(HEX_COLOR, t("colorInvalid"));
  return z.object({ primaryColor: color, accentColor: color });
}

export type BrandingValues = z.infer<ReturnType<typeof createBrandingSchema>>;
