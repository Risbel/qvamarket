import { z } from "zod";
import { normalizeRate } from "@/lib/exchange";
import { phoneCountrySchema } from "./checkout";
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

/** Public store profile (Settings > General): shown on the storefront and on order confirmations. */
export function createStoreProfileSchema(t: Translator) {
  return z.object({
    description: optionalText(t, 1000),
    phone: optionalText(t, 30).regex(/^[0-9+()\s-]*$/, t("phoneInvalid")),
    whatsapp: optionalText(t, 30).regex(/^[0-9+()\s-]*$/, t("phoneInvalid")),
    contactEmail: z.union([z.literal(""), z.email(t("emailInvalid"))]),
    address: optionalText(t, 300),
    phoneCountry: phoneCountrySchema,
    metaTitle: optionalText(t, 70),
    metaDescription: optionalText(t, 160),
  });
}
export type StoreProfileValues = z.infer<ReturnType<typeof createStoreProfileSchema>>;

/** Pickup settings (Settings > Pickup): shown to customers who pick up their order. */
export function createPickupSchema(t: Translator) {
  return z.object({
    pickupInstructions: optionalText(t, 1000),
  });
}
export type PickupValues = z.infer<ReturnType<typeof createPickupSchema>>;

const CURRENCY_CODE = /^[A-Z]{3}$/;
export const MAX_STORE_CURRENCIES = 10;

/**
 * Settings > Currencies: the enabled currencies in display order, the default one (shoppers
 * see it first) and the base one (prices are typed in it). Every other currency has a rate
 * per 1 base unit ("" = no automatic prices) and a rounding step for automatic prices, in
 * minor units (null = none; the server checks it against the currency's steps).
 */
export function createCurrenciesSchema(t: Translator) {
  return z
    .object({
      currencies: z
        .array(
          z.object({
            code: z.string().regex(CURRENCY_CODE),
            rate: z.string().trim(),
            roundingMinor: z.number().int().positive().nullable(),
          }),
        )
        .min(1, t("currencyRequired"))
        .max(MAX_STORE_CURRENCIES, t("tooManyCurrencies", { max: MAX_STORE_CURRENCIES })),
      defaultCode: z.string().regex(CURRENCY_CODE),
      baseCode: z.string().regex(CURRENCY_CODE),
    })
    .superRefine((values, ctx) => {
      const codes = values.currencies.map((c) => c.code);
      if (new Set(codes).size !== codes.length) ctx.addIssue({ code: "custom", path: ["currencies"], message: t("currencyRequired") });
      if (!codes.includes(values.defaultCode)) ctx.addIssue({ code: "custom", path: ["defaultCode"], message: t("currencyRequired") });
      if (!codes.includes(values.baseCode)) ctx.addIssue({ code: "custom", path: ["baseCode"], message: t("currencyRequired") });
      values.currencies.forEach((entry, i) => {
        if (entry.code !== values.baseCode && entry.rate !== "" && normalizeRate(entry.rate) === null) {
          ctx.addIssue({ code: "custom", path: ["currencies", i, "rate"], message: t("rateInvalid") });
        }
      });
    });
}
export type CurrenciesValues = z.infer<ReturnType<typeof createCurrenciesSchema>>;
