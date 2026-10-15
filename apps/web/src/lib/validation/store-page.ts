import { z } from "zod";
import { isReservedPageSlug, PAGE_CONTENT_MAX, PAGE_STATUSES, PAGE_TITLE_MAX } from "@/lib/store-pages";
import { URL_SLUG } from "./product";
import type { Translator } from "./types";

/** Custom page form (Settings > Pages). The slug is filled from the title, editable. */
export function createStorePageSchema(t: Translator) {
  return z.object({
    title: z.string().trim().min(1, t("required")).max(PAGE_TITLE_MAX, t("tooLong", { max: PAGE_TITLE_MAX })),
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .regex(URL_SLUG, t("urlSlugFormat"))
      .refine((slug): boolean => !isReservedPageSlug(slug), t("pageSlugReserved")),
    content: z.string().trim().max(PAGE_CONTENT_MAX, t("tooLong", { max: PAGE_CONTENT_MAX })),
    status: z.enum(PAGE_STATUSES),
    metaTitle: z.string().trim().max(70, t("tooLong", { max: 70 })),
    metaDescription: z.string().trim().max(160, t("tooLong", { max: 160 })),
  });
}
export type StorePageValues = z.infer<ReturnType<typeof createStorePageSchema>>;
