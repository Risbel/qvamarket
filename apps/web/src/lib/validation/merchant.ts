import { z } from "zod";
import { RESERVED_SLUGS, SLUG_PATTERN } from "@/lib/tenancy";
import type { Translator } from "./types";

export const MIN_PASSWORD_LENGTH = 8;

export function createMerchantSchema(t: Translator) {
  return z.object({
    companyName: z.string().trim().min(2, t("required")),
    storeName: z.string().trim().min(2, t("required")),
    storeSlug: z
      .string()
      .trim()
      .toLowerCase()
      .regex(SLUG_PATTERN, t("slugFormat"))
      .refine(
        (slug) => !(RESERVED_SLUGS as readonly string[]).includes(slug),
        t("slugReserved"),
      ),
    userName: z.string().trim().min(2, t("required")),
    userEmail: z.email(t("emailInvalid")).toLowerCase(),
    // Temporary password: the merchant must change it on first login
    temporaryPassword: z
      .string()
      .min(MIN_PASSWORD_LENGTH, t("passwordMin", { min: MIN_PASSWORD_LENGTH })),
  });
}

export type MerchantValues = z.infer<ReturnType<typeof createMerchantSchema>>;
