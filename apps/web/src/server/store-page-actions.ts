"use server";

import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { routing } from "@/i18n/routing";
import { createStorePageSchema } from "@/lib/validation/store-page";
import { createStorePage, deleteStorePage, updateStorePage } from "./store-pages";
import { getMerchantOrNull } from "./tenant";

// Custom store pages (Settings > Pages): store:update, like every other settings section.

export type StorePageActionResult =
  | { ok: true; id: string }
  | {
      ok: false;
      error: "forbidden" | "notFound" | "failed" | "invalid" | "slugTaken" | "limit";
      fieldErrors?: Record<string, string[]>;
    };

async function scopeOrNull() {
  const merchant = await getMerchantOrNull();
  if (!merchant || !merchant.can({ store: ["update"] })) return null;
  return { tenantId: merchant.tenantId, storeId: merchant.store.id };
}

async function parse(values: unknown, locale: string) {
  const t = await getTranslations({
    locale: hasLocale(routing.locales, locale) ? locale : routing.defaultLocale,
    namespace: "Validation",
  });
  return createStorePageSchema(t).safeParse(values);
}

async function guard(fn: () => Promise<StorePageActionResult>): Promise<StorePageActionResult> {
  try {
    return await fn();
  } catch (error) {
    console.error("store page action failed", error);
    return { ok: false, error: "failed" };
  }
}

export async function createStorePageAction(values: unknown, locale: string): Promise<StorePageActionResult> {
  const scope = await scopeOrNull();
  if (!scope) return { ok: false, error: "forbidden" };
  const parsed = await parse(values, locale);
  if (!parsed.success) {
    return { ok: false, error: "invalid", fieldErrors: z.flattenError(parsed.error).fieldErrors as Record<string, string[]> };
  }
  return guard(() => createStorePage(scope, parsed.data));
}

export async function updateStorePageAction(id: unknown, values: unknown, locale: string): Promise<StorePageActionResult> {
  const scope = await scopeOrNull();
  if (!scope) return { ok: false, error: "forbidden" };
  const pageId = z.uuid().safeParse(id);
  if (!pageId.success) return { ok: false, error: "notFound" };
  const parsed = await parse(values, locale);
  if (!parsed.success) {
    return { ok: false, error: "invalid", fieldErrors: z.flattenError(parsed.error).fieldErrors as Record<string, string[]> };
  }
  return guard(() => updateStorePage(scope, pageId.data, parsed.data));
}

export async function deleteStorePageAction(id: unknown): Promise<StorePageActionResult> {
  const scope = await scopeOrNull();
  if (!scope) return { ok: false, error: "forbidden" };
  const pageId = z.uuid().safeParse(id);
  if (!pageId.success) return { ok: false, error: "notFound" };
  return guard(async () =>
    (await deleteStorePage(scope, pageId.data)) ? { ok: true, id: pageId.data } : { ok: false, error: "notFound" },
  );
}
