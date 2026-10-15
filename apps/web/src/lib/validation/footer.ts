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
import { isSocialUrl, SOCIAL_NETWORK_KEYS, SOCIAL_NETWORKS, socialNetwork } from "@/lib/social";
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

/** Social media icons (Settings > Footer > Social media): one per network, array order = display order. */
export function createFooterSocialSchema(t: Translator) {
  const link = z
    .object({
      network: z.enum(SOCIAL_NETWORK_KEYS),
      url: z.string().trim().min(1, t("required")).max(FOOTER_URL_MAX, t("tooLong", { max: FOOTER_URL_MAX })),
    })
    .superRefine((value, ctx) => {
      if (value.url !== "" && !isSocialUrl(value.network, value.url)) {
        const network = socialNetwork(value.network);
        ctx.addIssue({
          code: "custom",
          path: ["url"],
          message: t("socialUrlInvalid", { name: network.name, domain: network.hosts[0] }),
        });
      }
    });
  return z.object({
    links: z
      .array(link)
      .max(SOCIAL_NETWORKS.length)
      .superRefine((links, ctx) => {
        const seen = new Set<string>();
        links.forEach((item, index) => {
          if (seen.has(item.network)) {
            ctx.addIssue({ code: "custom", path: [index, "network"], message: t("socialDuplicate") });
          }
          seen.add(item.network);
        });
      }),
  });
}
export type FooterSocialValues = z.infer<ReturnType<typeof createFooterSocialSchema>>;
