"use server";

import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { routing } from "@/i18n/routing";
import { parsePercent } from "@/lib/money";
import { planFeatureError, type PlanFeatureError, type PlanLimitError } from "@/lib/plans";
import {
  createProductSchema,
  toProductInput,
} from "@/lib/validation/product";
import {
  createProduct,
  deleteProduct,
  productHasOptions,
  updateProduct,
  type SaveProductResult,
} from "./products";
import { adjustPrices, setPricesAuto, type BulkPricesResult } from "./bulk-prices";
import { getMerchantOrNull } from "./tenant";

export type ProductActionResult =
  | { ok: true; id: string }
  | PlanLimitError
  | {
      ok: false;
      error:
        | "forbidden"
        | "notFound"
        | "failed"
        | "invalid"
        | Exclude<Extract<SaveProductResult, { ok: false }>, PlanLimitError>["error"];
      fieldErrors?: Record<string, string[]>;
    };

type Merchant = NonNullable<Awaited<ReturnType<typeof getMerchantOrNull>>>;

/** Validates the raw form values with the same schema as the client (never trusted). */
async function parseValues(values: unknown, locale: string, merchant: Merchant, simple = true) {
  const t = await getTranslations({
    locale: hasLocale(routing.locales, locale) ? locale : routing.defaultLocale,
    namespace: "Validation",
  });
  // The store's own currencies: a price in any other currency is rejected here
  const currencies = merchant.store.currencies;
  const parsed = createProductSchema(t, currencies, { simple }).safeParse(values);
  if (!parsed.success) {
    return {
      error: {
        ok: false,
        error: "invalid",
        fieldErrors: z.flattenError(parsed.error).fieldErrors as Record<string, string[]>,
      } satisfies ProductActionResult,
    };
  }
  return { data: toProductInput(parsed.data, currencies) };
}

const scopeOf = (merchant: Merchant) => ({
  tenantId: merchant.tenantId,
  storeId: merchant.store.id,
});

export async function createProductAction(
  storeId: unknown,
  values: unknown,
  locale: string,
): Promise<ProductActionResult> {
  const merchant = await getMerchantOrNull(storeId);
  if (!merchant || !merchant.can({ product: ["create"] })) {
    return { ok: false, error: "forbidden" };
  }
  const { data, error } = await parseValues(values, locale, merchant);
  if (error) return error;

  try {
    return await createProduct(scopeOf(merchant), merchant.subscription.plan, data, merchant.session.user.id);
  } catch (e) {
    console.error("createProductAction failed", e);
    return { ok: false, error: "failed" };
  }
}

export async function updateProductAction(
  storeId: unknown,
  id: unknown,
  values: unknown,
  locale: string,
): Promise<ProductActionResult> {
  const parsedId = z.uuid().safeParse(id);
  const merchant = await getMerchantOrNull(storeId);
  if (!merchant || !merchant.can({ product: ["update"] })) {
    return { ok: false, error: "forbidden" };
  }
  if (!parsedId.success) return { ok: false, error: "notFound" };
  const scope = scopeOf(merchant);
  // A product with options has no price/stock fields here (its variants have their own form)
  const hasOptions = await productHasOptions(scope, parsedId.data);
  if (hasOptions === null) return { ok: false, error: "notFound" };
  const { data, error } = await parseValues(values, locale, merchant, !hasOptions);
  if (error) return error;

  try {
    return await updateProduct(scope, merchant.subscription.plan, parsedId.data, data, merchant.session.user.id);
  } catch (e) {
    console.error("updateProductAction failed", e);
    return { ok: false, error: "failed" };
  }
}

export async function deleteProductAction(storeId: unknown, id: unknown): Promise<ProductActionResult> {
  const parsedId = z.uuid().safeParse(id);
  const merchant = await getMerchantOrNull(storeId);
  if (!merchant || !merchant.can({ product: ["delete"] })) {
    return { ok: false, error: "forbidden" };
  }
  if (!parsedId.success) return { ok: false, error: "notFound" };

  try {
    const deleted = await deleteProduct(scopeOf(merchant), parsedId.data);
    return deleted ? { ok: true, id: parsedId.data } : { ok: false, error: "notFound" };
  } catch (e) {
    console.error("deleteProductAction failed", e);
    return { ok: false, error: "failed" };
  }
}

// ---- bulk price changes from the products table (product:update)

export type BulkPricesActionResult =
  | { ok: true; changed: number }
  | PlanFeatureError
  | { ok: false; error: "forbidden" | "invalid" | "failed" | Extract<BulkPricesResult, { ok: false }>["error"] };

const bulkSchema = z.object({
  productIds: z.array(z.uuid()).min(1).max(1000),
  currencyCode: z.string().regex(/^[A-Z]{3}$/),
});

async function bulk(
  storeId: unknown,
  values: unknown,
  run: (scope: ReturnType<typeof scopeOf>, input: z.infer<typeof bulkSchema>) => Promise<BulkPricesResult | null>,
): Promise<BulkPricesActionResult> {
  const merchant = await getMerchantOrNull(storeId);
  if (!merchant || !merchant.can({ product: ["update"] })) return { ok: false, error: "forbidden" };
  if (!merchant.hasFeature("bulkPrices")) return planFeatureError("bulkPrices");
  const parsed = bulkSchema.safeParse(values);
  if (!parsed.success) return { ok: false, error: "invalid" };
  try {
    return (await run(scopeOf(merchant), parsed.data)) ?? { ok: false, error: "invalid" };
  } catch (e) {
    console.error("bulk prices action failed", e);
    return { ok: false, error: "failed" };
  }
}

/** The chosen products' prices in a currency follow the rate again (manual prices removed). */
export async function setPricesAutoAction(storeId: unknown, values: unknown): Promise<BulkPricesActionResult> {
  return bulk(storeId, values, (scope, input) => setPricesAuto(scope, input.productIds, input.currencyCode));
}

/** Raises or lowers by a percentage the chosen products' manual prices in a currency. */
export async function adjustPricesAction(storeId: unknown, values: unknown): Promise<BulkPricesActionResult> {
  const percent = z.object({ percent: z.string().max(10) }).safeParse(values);
  const basisPoints = percent.success ? parsePercent(percent.data.percent) : null;
  return bulk(storeId, values, (scope, input) =>
    basisPoints === null ? Promise.resolve(null) : adjustPrices(scope, input.productIds, input.currencyCode, basisPoints),
  );
}
