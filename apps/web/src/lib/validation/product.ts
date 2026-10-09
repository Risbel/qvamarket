import { z } from "zod";
import { parsePriceToMinor } from "@/lib/money";
import type { Translator } from "./types";

export const PRODUCT_STATUS_VALUES = ["draft", "active", "archived"] as const;
export const MAX_STOCK = 1_000_000_000;

/**
 * Form values are strings (what the inputs hold). The server converts them with
 * `toProductData`; the price is only valid for the store's currency decimals.
 */
export function createProductSchema(t: Translator, currencyDigits: number) {
  return z.object({
    name: z.string().trim().min(1, t("required")).max(120, t("tooLong", { max: 120 })),
    description: z.string().trim().max(2000, t("tooLong", { max: 2000 })),
    price: z
      .string()
      .trim()
      .min(1, t("required"))
      .refine((value) => parsePriceToMinor(value, currencyDigits) !== null, {
        message: t(currencyDigits === 0 ? "priceInvalidWhole" : "priceInvalid", {
          digits: currencyDigits,
        }),
      }),
    // empty = stock not tracked
    stock: z
      .string()
      .trim()
      .refine((value) => value === "" || /^\d+$/.test(value), t("stockInvalid"))
      .refine((value) => value === "" || Number(value) <= MAX_STOCK, t("stockInvalid")),
    status: z.enum(PRODUCT_STATUS_VALUES),
  });
}

export type ProductFormValues = z.infer<ReturnType<typeof createProductSchema>>;

/** Validated form values -> database values (price in minor units, empty stock = null). */
export function toProductData(values: ProductFormValues, currencyDigits: number) {
  const priceMinor = parsePriceToMinor(values.price, currencyDigits);
  if (priceMinor === null) throw new Error("price was not validated");
  return {
    name: values.name,
    description: values.description === "" ? null : values.description,
    priceMinor,
    stock: values.stock === "" ? null : Number(values.stock),
    status: values.status,
  };
}
