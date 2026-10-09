"use server";

import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { routing } from "@/i18n/routing";
import { currencyDigits } from "@/lib/money";
import {
  createProductSchema,
  toProductData,
} from "@/lib/validation/product";
import {
  createProduct,
  deleteProduct,
  updateProduct,
} from "./products";
import { getMerchantOrNull } from "./tenant";

export type ProductActionResult =
  | { ok: true; id: string }
  | {
      ok: false;
      error: "forbidden" | "notFound" | "failed" | "invalid";
      fieldErrors?: Record<string, string[]>;
    };

type Merchant = NonNullable<Awaited<ReturnType<typeof getMerchantOrNull>>>;

/** Validates the raw form values with the same schema as the client (never trusted). */
async function parseValues(values: unknown, locale: string, merchant: Merchant) {
  const t = await getTranslations({
    locale: hasLocale(routing.locales, locale) ? locale : routing.defaultLocale,
    namespace: "Validation",
  });
  const digits = currencyDigits(merchant.store.currency);
  const parsed = createProductSchema(t, digits).safeParse(values);
  if (!parsed.success) {
    return {
      error: {
        ok: false,
        error: "invalid",
        fieldErrors: z.flattenError(parsed.error).fieldErrors as Record<string, string[]>,
      } satisfies ProductActionResult,
    };
  }
  return { data: toProductData(parsed.data, digits) };
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
    return { ok: true, id: await createProduct(scopeOf(merchant), data) };
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
    const updated = await updateProduct(scopeOf(merchant), parsedId.data, data);
    return updated ? { ok: true, id: parsedId.data } : { ok: false, error: "notFound" };
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
