"use server";

import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { routing } from "@/i18n/routing";
import {
  createProductSchema,
  toProductInput,
} from "@/lib/validation/product";
import {
  createProduct,
  deleteProduct,
  updateProduct,
  type SaveProductResult,
} from "./products";
import { getMerchantOrNull } from "./tenant";

export type ProductActionResult =
  | { ok: true; id: string }
  | {
      ok: false;
      error:
        | "forbidden"
        | "notFound"
        | "failed"
        | "invalid"
        | Extract<SaveProductResult, { ok: false }>["error"];
      fieldErrors?: Record<string, string[]>;
    };

type Merchant = NonNullable<Awaited<ReturnType<typeof getMerchantOrNull>>>;

/** Validates the raw form values with the same schema as the client (never trusted). */
async function parseValues(values: unknown, locale: string, merchant: Merchant) {
  const t = await getTranslations({
    locale: hasLocale(routing.locales, locale) ? locale : routing.defaultLocale,
    namespace: "Validation",
  });
  // The store's own currencies: a price in any other currency is rejected here
  const currencies = merchant.store.currencies;
  const parsed = createProductSchema(t, currencies).safeParse(values);
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
  values: unknown,
  locale: string,
): Promise<ProductActionResult> {
  const merchant = await getMerchantOrNull();
  if (!merchant || !merchant.can({ product: ["create"] })) {
    return { ok: false, error: "forbidden" };
  }
  const { data, error } = await parseValues(values, locale, merchant);
  if (error) return error;

  try {
    return await createProduct(scopeOf(merchant), data);
  } catch (e) {
    console.error("createProductAction failed", e);
    return { ok: false, error: "failed" };
  }
}

export async function updateProductAction(
  id: unknown,
  values: unknown,
  locale: string,
): Promise<ProductActionResult> {
  const parsedId = z.uuid().safeParse(id);
  const merchant = await getMerchantOrNull();
  if (!merchant || !merchant.can({ product: ["update"] })) {
    return { ok: false, error: "forbidden" };
  }
  if (!parsedId.success) return { ok: false, error: "notFound" };
  const { data, error } = await parseValues(values, locale, merchant);
  if (error) return error;

  try {
    return await updateProduct(scopeOf(merchant), parsedId.data, data);
  } catch (e) {
    console.error("updateProductAction failed", e);
    return { ok: false, error: "failed" };
  }
}

export async function deleteProductAction(id: unknown): Promise<ProductActionResult> {
  const parsedId = z.uuid().safeParse(id);
  const merchant = await getMerchantOrNull();
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
