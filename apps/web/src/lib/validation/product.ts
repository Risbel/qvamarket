import { z } from "zod";
import { parsePriceToMinor } from "@/lib/money";
import { slugify } from "@/lib/slug";
import type { Translator } from "./types";

export const PRODUCT_STATUS_VALUES = ["draft", "active", "archived"] as const;
export const MAX_STOCK = 1_000_000_000;
export const MAX_TIERS = 5;
export const MAX_TIER_QUANTITY = 100_000;
export const MAX_TAGS = 20;
/** Product and category URLs: lowercase, digits and hyphens, at most 80 characters. */
export const URL_SLUG = /^[a-z0-9]([a-z0-9-]{0,78}[a-z0-9])?$/;

export type FormCurrency = { code: string; digits: number; isDefault: boolean };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** "Camisa, Algodón,  verano " -> ["camisa", "algodón", "verano"] */
export function parseTags(input: string): string[] {
  return [
    ...new Set(
      input
        .split(",")
        .map((tag) => tag.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
}

/**
 * Form values are strings (what the inputs hold). There is one `prices` entry per currency the
 * store sells in: the default currency's price is required, the others are optional (empty =
 * not sold in that currency). Each currency can have a compare-at ("was") price and volume
 * tiers ("from 10 units: ..."). The server converts everything with `toProductInput`.
 */
export function createProductSchema(t: Translator, currencies: FormCurrency[]) {
  const digitsOf = new Map(currencies.map((c) => [c.code, c.digits]));
  const defaultCode = currencies.find((c) => c.isDefault)?.code;
  const priceMessage = (digits: number) =>
    t(digits === 0 ? "priceInvalidWhole" : "priceInvalid", { digits });

  return z.object({
    name: z.string().trim().min(1, t("required")).max(120, t("tooLong", { max: 120 })),
    description: z.string().trim().max(5000, t("tooLong", { max: 5000 })),
    status: z.enum(PRODUCT_STATUS_VALUES),
    slug: z.string().trim().toLowerCase().regex(URL_SLUG, t("urlSlugFormat")),
    categoryId: z.string().refine((value) => value === "" || UUID.test(value), t("required")),
    tags: z
      .string()
      .refine((value) => parseTags(value).length <= MAX_TAGS, t("tooManyTags", { max: MAX_TAGS }))
      .refine((value) => parseTags(value).every((tag) => tag.length <= 40), t("tagTooLong", { max: 40 })),
    metaTitle: z.string().trim().max(70, t("tooLong", { max: 70 })),
    metaDescription: z.string().trim().max(160, t("tooLong", { max: 160 })),
    sku: z.string().trim().max(64, t("tooLong", { max: 64 })),
    // empty = stock not tracked
    stock: z
      .string()
      .trim()
      .refine((value) => value === "" || /^\d+$/.test(value), t("stockInvalid"))
      .refine((value) => value === "" || Number(value) <= MAX_STOCK, t("stockInvalid")),
    prices: z
      .array(
        z.object({
          currency: z.string().refine((code) => digitsOf.has(code)),
          price: z.string().trim(),
          compareAt: z.string().trim(),
          tiers: z
            .array(z.object({ minQuantity: z.string().trim(), price: z.string().trim() }))
            .max(MAX_TIERS, t("tooManyTiers", { max: MAX_TIERS })),
        }),
      )
      .superRefine((prices, ctx) => {
        prices.forEach((entry, i) => {
          const digits = digitsOf.get(entry.currency) ?? 2;
          const isDefault = entry.currency === defaultCode;

          if (entry.price === "") {
            if (isDefault) {
              ctx.addIssue({ code: "custom", path: [i, "price"], message: t("required") });
            } else if (entry.compareAt !== "" || entry.tiers.length > 0) {
              ctx.addIssue({ code: "custom", path: [i, "price"], message: t("priceNeededFirst") });
            }
            return;
          }
          const price = parsePriceToMinor(entry.price, digits);
          if (price === null) {
            ctx.addIssue({ code: "custom", path: [i, "price"], message: priceMessage(digits) });
            return;
          }

          if (entry.compareAt !== "") {
            const compareAt = parsePriceToMinor(entry.compareAt, digits);
            if (compareAt === null) {
              ctx.addIssue({ code: "custom", path: [i, "compareAt"], message: priceMessage(digits) });
            } else if (compareAt <= price) {
              ctx.addIssue({ code: "custom", path: [i, "compareAt"], message: t("compareAtHigher") });
            }
          }

          const seen = new Set<number>();
          entry.tiers.forEach((tier, k) => {
            const quantity = Number(tier.minQuantity);
            if (!/^\d+$/.test(tier.minQuantity) || quantity < 2 || quantity > MAX_TIER_QUANTITY) {
              ctx.addIssue({ code: "custom", path: [i, "tiers", k, "minQuantity"], message: t("tierQuantity", { max: MAX_TIER_QUANTITY }) });
            } else if (seen.has(quantity)) {
              ctx.addIssue({ code: "custom", path: [i, "tiers", k, "minQuantity"], message: t("tierRepeated") });
            } else {
              seen.add(quantity);
            }
            const tierPrice = parsePriceToMinor(tier.price, digits);
            if (tierPrice === null) {
              ctx.addIssue({ code: "custom", path: [i, "tiers", k, "price"], message: priceMessage(digits) });
            } else if (tierPrice >= price) {
              ctx.addIssue({ code: "custom", path: [i, "tiers", k, "price"], message: t("tierCheaper") });
            }
          });
        });
      }),
  });
}

export type ProductFormValues = z.infer<ReturnType<typeof createProductSchema>>;

export type ProductInput = {
  product: {
    name: string;
    description: string | null;
    status: (typeof PRODUCT_STATUS_VALUES)[number];
    slug: string;
    categoryId: string | null;
    tags: string[];
    metaTitle: string | null;
    metaDescription: string | null;
  };
  variant: { sku: string | null; stock: number | null };
  /** regular prices of the (default) variant: one row per currency and tier */
  prices: { currencyCode: string; minQuantity: number; amountMinor: number; compareAtMinor: number | null }[];
};

/** Validated form values -> database values (minor units, nulls for empty fields). */
export function toProductInput(values: ProductFormValues, currencies: FormCurrency[]): ProductInput {
  const digitsOf = new Map(currencies.map((c) => [c.code, c.digits]));
  const minor = (text: string, code: string) => {
    const value = parsePriceToMinor(text, digitsOf.get(code) ?? 2);
    if (value === null) throw new Error("price was not validated");
    return value;
  };
  const orNull = (text: string) => (text === "" ? null : text);

  return {
    product: {
      name: values.name,
      description: orNull(values.description),
      status: values.status,
      slug: values.slug || slugify(values.name),
      categoryId: orNull(values.categoryId),
      tags: parseTags(values.tags),
      metaTitle: orNull(values.metaTitle),
      metaDescription: orNull(values.metaDescription),
    },
    variant: {
      sku: orNull(values.sku),
      stock: values.stock === "" ? null : Number(values.stock),
    },
    prices: values.prices
      .filter((entry) => entry.price !== "")
      .flatMap((entry) => [
        {
          currencyCode: entry.currency,
          minQuantity: 1,
          amountMinor: minor(entry.price, entry.currency),
          compareAtMinor: entry.compareAt === "" ? null : minor(entry.compareAt, entry.currency),
        },
        ...entry.tiers.map((tier) => ({
          currencyCode: entry.currency,
          minQuantity: Number(tier.minQuantity),
          amountMinor: minor(tier.price, entry.currency),
          compareAtMinor: null,
        })),
      ]),
  };
}
