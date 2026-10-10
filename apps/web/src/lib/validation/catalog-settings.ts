import { z } from "zod";
import type { Translator } from "./types";

/** Category form: only the name; its identifier (#anchor) is generated from it on the server. */
export function createCategorySchema(t: Translator) {
  return z.object({
    name: z.string().trim().min(1, t("required")).max(60, t("tooLong", { max: 60 })),
  });
}
export type CategoryValues = z.infer<ReturnType<typeof createCategorySchema>>;

const optionalText = (t: Translator, max: number) =>
  z.string().trim().max(max, t("tooLong", { max }));

/** Public store profile: shown on the storefront and on the order confirmation (pickup). */
export function createStoreProfileSchema(t: Translator) {
  return z.object({
    description: optionalText(t, 1000),
    phone: optionalText(t, 30).regex(/^[0-9+()\s-]*$/, t("phoneInvalid")),
    whatsapp: optionalText(t, 30).regex(/^[0-9+()\s-]*$/, t("phoneInvalid")),
    contactEmail: z.union([z.literal(""), z.email(t("emailInvalid"))]),
    address: optionalText(t, 300),
    pickupInstructions: optionalText(t, 1000),
    metaTitle: optionalText(t, 70),
    metaDescription: optionalText(t, 160),
  });
}
export type StoreProfileValues = z.infer<ReturnType<typeof createStoreProfileSchema>>;

export function createCurrenciesSchema(t: Translator) {
  return z
    .object({
      codes: z.array(z.string().regex(/^[A-Z]{3}$/)).min(1, t("currencyRequired")).max(10, t("tooManyCurrencies", { max: 10 })),
      defaultCode: z.string().regex(/^[A-Z]{3}$/),
    })
    .refine((v) => v.codes.includes(v.defaultCode), { path: ["defaultCode"], message: t("currencyRequired") });
}
export type CurrenciesValues = z.infer<ReturnType<typeof createCurrenciesSchema>>;
