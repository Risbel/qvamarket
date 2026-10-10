"use server";

import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { routing } from "@/i18n/routing";
import { createOptionsSchema, createVariantsSchema, toVariantsInput } from "@/lib/validation/product";
import { getMerchantOrNull } from "./tenant";
import { saveVariants, setProductOptions } from "./variants";

export type VariantActionResult =
  | { ok: true }
  | {
      ok: false;
      error: "forbidden" | "notFound" | "invalid" | "stale" | "skuTaken" | "failed";
      fieldErrors?: Record<string, string[]>;
      /** skuTaken: rows whose SKU another product already uses */
      indexes?: number[];
    };

async function translator(locale: string) {
  return getTranslations({
    locale: hasLocale(routing.locales, locale) ? locale : routing.defaultLocale,
    namespace: "Validation",
  });
}

/** Both actions need product:update (same as editing the product itself). */
async function merchantWithUpdate() {
  const merchant = await getMerchantOrNull();
  return merchant && merchant.can({ product: ["update"] }) ? merchant : null;
}

export async function setProductOptionsAction(
  productId: unknown,
  values: unknown,
  locale: string,
): Promise<VariantActionResult> {
  const merchant = await merchantWithUpdate();
  if (!merchant) return { ok: false, error: "forbidden" };
  const id = z.uuid().safeParse(productId);
  if (!id.success) return { ok: false, error: "notFound" };
  const parsed = createOptionsSchema(await translator(locale)).safeParse(values);
  if (!parsed.success) {
    return { ok: false, error: "invalid", fieldErrors: z.flattenError(parsed.error).fieldErrors as Record<string, string[]> };
  }
  try {
    return await setProductOptions({ tenantId: merchant.tenantId, storeId: merchant.store.id }, id.data, parsed.data.options);
  } catch (error) {
    console.error("setProductOptionsAction failed", error);
    return { ok: false, error: "failed" };
  }
}

export async function saveVariantsAction(
  productId: unknown,
  values: unknown,
  locale: string,
): Promise<VariantActionResult> {
  const merchant = await merchantWithUpdate();
  if (!merchant) return { ok: false, error: "forbidden" };
  const id = z.uuid().safeParse(productId);
  if (!id.success) return { ok: false, error: "notFound" };
  // The store's own currencies: a price in any other currency is rejected
  const currencies = merchant.store.currencies;
  const parsed = createVariantsSchema(await translator(locale), currencies).safeParse(values);
  if (!parsed.success) {
    return { ok: false, error: "invalid", fieldErrors: z.flattenError(parsed.error).fieldErrors as Record<string, string[]> };
  }
  try {
    return await saveVariants(
      { tenantId: merchant.tenantId, storeId: merchant.store.id },
      id.data,
      toVariantsInput(parsed.data, currencies),
    );
  } catch (error) {
    console.error("saveVariantsAction failed", error);
    return { ok: false, error: "failed" };
  }
}
