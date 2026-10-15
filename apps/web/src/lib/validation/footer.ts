import { z } from "zod";
import {
  FOOTER_LABEL_MAX,
  FOOTER_TEXT_MAX,
  FOOTER_TITLE_MAX,
  FOOTER_URL_MAX,
  isSafeLinkUrl,
  MAX_FOOTER_GROUPS,
  MAX_FOOTER_LINKS,
} from "@/lib/footer";
import type { Translator } from "./types";

/** Footer links (Settings > Footer > Links). Array order = display order. */
export function createFooterLinksSchema(t: Translator) {
  const link = z.object({
    label: z.string().trim().min(1, t("required")).max(FOOTER_LABEL_MAX, t("tooLong", { max: FOOTER_LABEL_MAX })),
    url: z
      .string()
      .trim()
      .min(1, t("required"))
      .max(FOOTER_URL_MAX, t("tooLong", { max: FOOTER_URL_MAX }))
      .refine((url): boolean => isSafeLinkUrl(url), t("linkUrlInvalid")),
    newTab: z.boolean(),
  });
  const group = z.object({
    title: z.string().trim().min(1, t("required")).max(FOOTER_TITLE_MAX, t("tooLong", { max: FOOTER_TITLE_MAX })),
    links: z
      .array(link)
      .min(1, t("footerLinksRequired"))
      .max(MAX_FOOTER_LINKS, t("footerTooManyLinks", { max: MAX_FOOTER_LINKS })),
  });
  return z.object({
    groups: z.array(group).max(MAX_FOOTER_GROUPS, t("footerTooManyGroups", { max: MAX_FOOTER_GROUPS })),
  });
}
export type FooterLinksValues = z.infer<ReturnType<typeof createFooterLinksSchema>>;

/** Short text under the logo + name (Settings > Footer > About). Empty = none. */
export function createFooterTextSchema(t: Translator) {
  return z.object({
    footerText: z.string().trim().max(FOOTER_TEXT_MAX, t("tooLong", { max: FOOTER_TEXT_MAX })),
  });
}
export type FooterTextValues = z.infer<ReturnType<typeof createFooterTextSchema>>;
