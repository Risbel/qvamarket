import { z } from "zod";
import { MAX_IMAGES_PER_PRODUCT } from "@/lib/images";
import { parsePriceToMinor } from "@/lib/money";
import { slugify } from "@/lib/slug";
import type { Translator } from "./types";

export const PRODUCT_STATUS_VALUES = ["draft", "active", "archived"] as const;
export const MAX_STOCK = 1_000_000_000;
export const MAX_TIERS = 5;
export const MAX_TIER_QUANTITY = 100_000;
export const MAX_TAGS = 20;
export const MAX_OPTIONS = 3;
export const MAX_OPTION_VALUES = 20;
/** Combinations of option values a product may have (also keeps the variants form light). */
export const MAX_VARIANTS = 50;
/** Product and category URLs: lowercase, digits and hyphens, at most 80 characters. */
export const URL_SLUG = /^[a-z0-9]([a-z0-9-]{0,78}[a-z0-9])?$/;

/** A store currency as the forms see it (same shape as StoreCurrency, see src/lib/exchange.ts). */
export type FormCurrency = {
  code: string;
  digits: number;
  isDefault: boolean;
  isBase: boolean;
  rate: string | null;
  roundingMinor: number | null;
};

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

const priceMessage = (t: Translator, digits: number) =>
  t(digits === 0 ? "priceInvalidWhole" : "priceInvalid", { digits });

/** SKU field (empty = none). */
export const skuSchema = (t: Translator) => z.string().trim().max(64, t("tooLong", { max: 64 }));

/** Stock field (empty = not tracked). */
export const stockSchema = (t: Translator) =>
  z
    .string()
    .trim()
    .refine((value) => value === "" || /^\d+$/.test(value), t("stockInvalid"))
    .refine((value) => value === "" || Number(value) <= MAX_STOCK, t("stockInvalid"));

/**
 * The stock the form was opened with (hidden field, "" = not tracked): the server keeps the
 * live stock when the field was not touched, and refuses a new count if it moved meanwhile.
 */
export const stockLoadedSchema = z.string().max(12);

/** stockLoadedSchema value -> number or null (anything that is not a count = not tracked). */
export function parseLoadedStock(text: string): number | null {
  return /^\d{1,10}$/.test(text) ? Number(text) : null;
}

/**
 * The prices of one variant, as form strings: one entry per currency the store sells in. The
 * base currency's price is required (with `requireBase`). Another currency is `manual` (its
 * own prices, price required) or not (it follows the base prices through the rate; its fields
 * are ignored). Each currency can have a compare-at ("was") price and volume tiers ("from 10
 * units: ..."). Converted to rows by `pricesToRows`.
 */
export function createPricesSchema(t: Translator, currencies: FormCurrency[], { requireBase = true } = {}) {
  const digitsOf = new Map(currencies.map((c) => [c.code, c.digits]));
  const baseCode = (currencies.find((c) => c.isBase) ?? currencies.find((c) => c.isDefault))?.code;

  return z
    .array(
      z.object({
        currency: z.string().refine((code) => digitsOf.has(code)),
        manual: z.boolean(),
        price: z.string().trim(),
        compareAt: z.string().trim(),
        tiers: z
          .array(z.object({ minQuantity: z.string().trim(), price: z.string().trim() }))
          .max(MAX_TIERS, t("tooManyTiers", { max: MAX_TIERS })),
      }),
    )
    .superRefine((prices, ctx) => {
      if (requireBase && !prices.some((entry) => entry.currency === baseCode)) {
        ctx.addIssue({ code: "custom", path: [], message: t("required") });
      }
      prices.forEach((entry, i) => {
        const digits = digitsOf.get(entry.currency) ?? 2;
        const isBase = entry.currency === baseCode;
        if (!isBase && !entry.manual) return; // follows the rate: nothing typed is used

        if (entry.price === "") {
          if (isBase && requireBase) {
            ctx.addIssue({ code: "custom", path: [i, "price"], message: t("required") });
          } else if (!isBase) {
            ctx.addIssue({ code: "custom", path: [i, "price"], message: t("manualPriceRequired") });
          } else if (entry.compareAt !== "" || entry.tiers.length > 0) {
            ctx.addIssue({ code: "custom", path: [i, "price"], message: t("priceNeededFirst") });
          }
          return;
        }
        const price = parsePriceToMinor(entry.price, digits);
        if (price === null) {
          ctx.addIssue({ code: "custom", path: [i, "price"], message: priceMessage(t, digits) });
          return;
        }

        if (entry.compareAt !== "") {
          const compareAt = parsePriceToMinor(entry.compareAt, digits);
          if (compareAt === null) {
            ctx.addIssue({ code: "custom", path: [i, "compareAt"], message: priceMessage(t, digits) });
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
            ctx.addIssue({ code: "custom", path: [i, "tiers", k, "price"], message: priceMessage(t, digits) });
          } else if (tierPrice >= price) {
            ctx.addIssue({ code: "custom", path: [i, "tiers", k, "price"], message: t("tierCheaper") });
          }
        });
      });
    });
}

export type PricesFormValues = z.infer<ReturnType<typeof createPricesSchema>>;

/**
 * The product's images in display order (the first is the main image): `existing` = a saved
 * `product_image`, `upload` = a staged upload made from this form (see server/product-images.ts).
 */
export const IMAGE_REF_KINDS = ["existing", "upload"] as const;
export type ImageRef = { kind: (typeof IMAGE_REF_KINDS)[number]; id: string };

const imagesSchema = (t: Translator) =>
  z
    .array(z.object({ kind: z.enum(IMAGE_REF_KINDS), id: z.string().refine((value) => UUID.test(value)) }))
    .max(MAX_IMAGES_PER_PRODUCT, t("tooManyImages", { max: MAX_IMAGES_PER_PRODUCT }))
    .refine((refs) => new Set(refs.map((ref) => ref.id)).size === refs.length);
export type PriceRowInput = { currencyCode: string; minQuantity: number; amountMinor: number; compareAtMinor: number | null };

/**
 * Product form. `simple`: the product has no options, so the SKU, stock and prices of its
 * (default) variant are edited here. A product with options sends empty variant fields
 * (`prices: []`) that the server ignores: its variants have their own form.
 */
export function createProductSchema(t: Translator, currencies: FormCurrency[], { simple = true } = {}) {
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
    sku: skuSchema(t),
    stock: stockSchema(t),
    stockLoaded: stockLoadedSchema,
    prices: createPricesSchema(t, currencies, { requireBase: simple }),
    images: imagesSchema(t),
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
  /** stockLoaded: the stock the form showed (see stockLoadedSchema) */
  variant: { sku: string | null; stock: number | null; stockLoaded: number | null };
  /** regular prices of the (default) variant: one row per currency and tier */
  prices: PriceRowInput[];
  /** the product's images, main first: makes the saved list exactly this */
  images: ImageRef[];
};

/** Validated price entries -> variant_price rows (minor units). Currencies following the rate get none. */
export function pricesToRows(prices: PricesFormValues, currencies: FormCurrency[]): PriceRowInput[] {
  const digitsOf = new Map(currencies.map((c) => [c.code, c.digits]));
  const baseCode = (currencies.find((c) => c.isBase) ?? currencies.find((c) => c.isDefault))?.code;
  const minor = (text: string, code: string) => {
    const value = parsePriceToMinor(text, digitsOf.get(code) ?? 2);
    if (value === null) throw new Error("price was not validated");
    return value;
  };
  return prices
    .filter((entry) => (entry.manual || entry.currency === baseCode) && entry.price !== "")
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
    ]);
}

/** Validated form values -> database values (minor units, nulls for empty fields). */
export function toProductInput(values: ProductFormValues, currencies: FormCurrency[]): ProductInput {
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
      stockLoaded: parseLoadedStock(values.stockLoaded),
    },
    prices: pricesToRows(values.prices, currencies),
    images: values.images,
  };
}

// ---- options and variants

const optionalId = z.string().refine((value) => value === "" || UUID.test(value));
const sameText = (a: string, b: string) => a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();

/**
 * Options of a product ("Talla": S, M, L). `id` is "" for new options and values; existing ones
 * keep their id, so renaming a value keeps its variant (prices, stock). The number of
 * combinations is capped at MAX_VARIANTS. No options = simple product.
 */
export function createOptionsSchema(t: Translator) {
  return z
    .object({
      options: z
        .array(
          z.object({
            id: optionalId,
            name: z.string().trim().min(1, t("required")).max(30, t("tooLong", { max: 30 })),
            values: z
              .array(
                z.object({
                  id: optionalId,
                  value: z.string().trim().min(1, t("required")).max(40, t("tooLong", { max: 40 })),
                }),
              )
              .min(1, t("optionValuesRequired"))
              .max(MAX_OPTION_VALUES, t("tooManyOptionValues", { max: MAX_OPTION_VALUES })),
          }),
        )
        .max(MAX_OPTIONS, t("tooManyOptions", { max: MAX_OPTIONS })),
    })
    .superRefine(({ options }, ctx) => {
      options.forEach((option, i) => {
        if (options.slice(0, i).some((other) => sameText(other.name, option.name))) {
          ctx.addIssue({ code: "custom", path: ["options", i, "name"], message: t("optionNameRepeated") });
        }
        option.values.forEach((entry, k) => {
          if (option.values.slice(0, k).some((other) => sameText(other.value, entry.value))) {
            ctx.addIssue({ code: "custom", path: ["options", i, "values", k, "value"], message: t("optionValueRepeated") });
          }
        });
      });
      const combinations = options.reduce((total, option) => total * Math.max(option.values.length, 1), 1);
      if (options.length > 0 && combinations > MAX_VARIANTS) {
        ctx.addIssue({
          code: "custom",
          path: ["options"],
          message: t("tooManyVariants", { max: MAX_VARIANTS, count: combinations }),
        });
      }
    });
}

export type OptionsFormValues = z.infer<ReturnType<typeof createOptionsSchema>>;

/** Variants form: SKU, stock and prices of every variant of a product with options. */
export function createVariantsSchema(t: Translator, currencies: FormCurrency[]) {
  return z
    .object({
      variants: z
        .array(
          z.object({
            id: z.string().refine((value) => UUID.test(value)),
            sku: skuSchema(t),
            stock: stockSchema(t),
            stockLoaded: stockLoadedSchema,
            prices: createPricesSchema(t, currencies),
          }),
        )
        .min(1)
        .max(MAX_VARIANTS),
    })
    .superRefine(({ variants }, ctx) => {
      variants.forEach((variant, i) => {
        if (variant.sku !== "" && variants.slice(0, i).some((other) => other.sku === variant.sku)) {
          ctx.addIssue({ code: "custom", path: ["variants", i, "sku"], message: t("skuRepeated") });
        }
      });
    });
}

export type VariantsFormValues = z.infer<ReturnType<typeof createVariantsSchema>>;

export type VariantInput = {
  id: string;
  sku: string | null;
  stock: number | null;
  stockLoaded: number | null;
  prices: PriceRowInput[];
};

export function toVariantsInput(values: VariantsFormValues, currencies: FormCurrency[]): VariantInput[] {
  return values.variants.map((variant) => ({
    id: variant.id,
    sku: variant.sku === "" ? null : variant.sku,
    stock: variant.stock === "" ? null : Number(variant.stock),
    stockLoaded: parseLoadedStock(variant.stockLoaded),
    prices: pricesToRows(variant.prices, currencies),
  }));
}
