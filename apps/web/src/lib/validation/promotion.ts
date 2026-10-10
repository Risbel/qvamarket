import { z } from "zod";
import { parsePriceToMinor } from "@/lib/money";
import type { FormCurrency } from "./product";
import type { Translator } from "./types";

export const PROMOTION_KINDS = ["sale", "override"] as const;
export const PROMOTION_STATUSES = ["draft", "active"] as const;
/** Variant rows in one promotion (also keeps the form light). */
export const MAX_PROMOTION_VARIANTS = 300;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const validDate = (value: string) => value === "" || !Number.isNaN(Date.parse(value));

/**
 * A promotion: a named set of prices for some variants, between optional dates.
 *  - kind "sale": shown as a discount (the regular price struck through); it only applies
 *    while it is cheaper than the regular price, so the price must be lower;
 *  - kind "override": a special price that simply replaces the regular one.
 * Dates are strings: the browser's local "YYYY-MM-DDTHH:mm" in the form, converted to ISO
 * (UTC) before they are sent; empty = no limit. One entry per variant and currency of the
 * store; an empty price = no promotion price in that currency.
 */
export function createPromotionSchema(t: Translator, currencies: FormCurrency[]) {
  const digitsOf = new Map(currencies.map((c) => [c.code, c.digits]));
  return z
    .object({
      name: z.string().trim().min(1, t("required")).max(60, t("tooLong", { max: 60 })),
      kind: z.enum(PROMOTION_KINDS),
      status: z.enum(PROMOTION_STATUSES),
      startsAt: z.string().trim().refine(validDate, t("dateInvalid")),
      endsAt: z.string().trim().refine(validDate, t("dateInvalid")),
      items: z
        .array(
          z.object({
            variantId: z.string().refine((value) => UUID.test(value)),
            prices: z.array(
              z.object({
                currency: z.string().refine((code) => digitsOf.has(code)),
                price: z.string().trim(),
              }),
            ),
          }),
        )
        .max(MAX_PROMOTION_VARIANTS, t("tooManyPromotionItems", { max: MAX_PROMOTION_VARIANTS })),
    })
    .superRefine((values, ctx) => {
      if (values.startsAt && values.endsAt && Date.parse(values.endsAt) <= Date.parse(values.startsAt)) {
        ctx.addIssue({ code: "custom", path: ["endsAt"], message: t("endsBeforeStart") });
      }
      const seen = new Set<string>();
      values.items.forEach((item, i) => {
        if (seen.has(item.variantId)) ctx.addIssue({ code: "custom", path: ["items", i], message: t("required") });
        seen.add(item.variantId);
        item.prices.forEach((entry, k) => {
          if (entry.price === "") return;
          const digits = digitsOf.get(entry.currency) ?? 2;
          if (parsePriceToMinor(entry.price, digits) === null) {
            ctx.addIssue({
              code: "custom",
              path: ["items", i, "prices", k, "price"],
              message: t(digits === 0 ? "priceInvalidWhole" : "priceInvalid", { digits }),
            });
          }
        });
      });
    });
}

export type PromotionFormValues = z.infer<ReturnType<typeof createPromotionSchema>>;

export type PromotionInput = {
  name: string;
  kind: (typeof PROMOTION_KINDS)[number];
  status: (typeof PROMOTION_STATUSES)[number];
  startsAt: Date | null;
  endsAt: Date | null;
  /** promotion prices for 1 unit */
  prices: { variantId: string; currencyCode: string; amountMinor: number }[];
};

/** Validated values -> database values (minor units, dates, empty prices dropped). */
export function toPromotionInput(values: PromotionFormValues, currencies: FormCurrency[]): PromotionInput {
  const digitsOf = new Map(currencies.map((c) => [c.code, c.digits]));
  return {
    name: values.name,
    kind: values.kind,
    status: values.status,
    startsAt: values.startsAt ? new Date(values.startsAt) : null,
    endsAt: values.endsAt ? new Date(values.endsAt) : null,
    prices: values.items.flatMap((item) =>
      item.prices
        .filter((entry) => entry.price !== "")
        .map((entry) => {
          const amountMinor = parsePriceToMinor(entry.price, digitsOf.get(entry.currency) ?? 2);
          if (amountMinor === null) throw new Error("price was not validated");
          return { variantId: item.variantId, currencyCode: entry.currency, amountMinor };
        }),
    ),
  };
}
