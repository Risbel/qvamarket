"use server";

import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { routing } from "@/i18n/routing";
import type { PermissionRequest } from "@/lib/permissions";
import { createPromotionSchema, toPromotionInput } from "@/lib/validation/promotion";
import { deletePromotion, savePromotion, setPromotionStatus } from "./promotions";
import { getMerchantOrNull } from "./tenant";

export type PromotionActionResult =
  | { ok: true; id: string }
  | {
      ok: false;
      error: "forbidden" | "notFound" | "invalid" | "stale" | "notCheaper" | "failed";
      fieldErrors?: Record<string, string[]>;
      /** notCheaper: the variant/currency prices that are not below the regular price */
      rows?: { variantId: string; currencyCode: string }[];
    };

async function merchantWith(storeId: unknown, request: PermissionRequest) {
  const merchant = await getMerchantOrNull(storeId);
  return merchant && merchant.can(request) ? merchant : null;
}

async function save(storeId: unknown, id: string | null, values: unknown, locale: string): Promise<PromotionActionResult> {
  const merchant = await merchantWith(storeId, { promotion: [id ? "update" : "create"] });
  if (!merchant) return { ok: false, error: "forbidden" };
  const t = await getTranslations({
    locale: hasLocale(routing.locales, locale) ? locale : routing.defaultLocale,
    namespace: "Validation",
  });
  // The store's own currencies: a price in any other currency is rejected
  const currencies = merchant.store.currencies;
  const parsed = createPromotionSchema(t, currencies).safeParse(values);
  if (!parsed.success) {
    return { ok: false, error: "invalid", fieldErrors: z.flattenError(parsed.error).fieldErrors as Record<string, string[]> };
  }
  try {
    return await savePromotion({ tenantId: merchant.tenantId, storeId: merchant.store.id }, id, toPromotionInput(parsed.data, currencies));
  } catch (error) {
    console.error("savePromotion failed", error);
    return { ok: false, error: "failed" };
  }
}

export async function createPromotionAction(storeId: unknown, values: unknown, locale: string) {
  return save(storeId, null, values, locale);
}

export async function updatePromotionAction(storeId: unknown, id: unknown, values: unknown, locale: string): Promise<PromotionActionResult> {
  const parsedId = z.uuid().safeParse(id);
  if (!parsedId.success) return { ok: false, error: "notFound" };
  return save(storeId, parsedId.data, values, locale);
}

export async function setPromotionStatusAction(storeId: unknown, id: unknown, status: unknown): Promise<PromotionActionResult> {
  const merchant = await merchantWith(storeId, { promotion: ["update"] });
  if (!merchant) return { ok: false, error: "forbidden" };
  const parsedId = z.uuid().safeParse(id);
  if (!parsedId.success || (status !== "draft" && status !== "active")) return { ok: false, error: "notFound" };
  try {
    const done = await setPromotionStatus({ tenantId: merchant.tenantId, storeId: merchant.store.id }, parsedId.data, status);
    return done ? { ok: true, id: parsedId.data } : { ok: false, error: "notFound" };
  } catch (error) {
    console.error("setPromotionStatus failed", error);
    return { ok: false, error: "failed" };
  }
}

export async function deletePromotionAction(storeId: unknown, id: unknown): Promise<PromotionActionResult> {
  const merchant = await merchantWith(storeId, { promotion: ["delete"] });
  if (!merchant) return { ok: false, error: "forbidden" };
  const parsedId = z.uuid().safeParse(id);
  if (!parsedId.success) return { ok: false, error: "notFound" };
  try {
    const done = await deletePromotion({ tenantId: merchant.tenantId, storeId: merchant.store.id }, parsedId.data);
    return done ? { ok: true, id: parsedId.data } : { ok: false, error: "notFound" };
  } catch (error) {
    console.error("deletePromotion failed", error);
    return { ok: false, error: "failed" };
  }
}
