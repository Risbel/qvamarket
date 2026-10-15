"use server";

import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { routing } from "@/i18n/routing";
import {
  createCategorySchema,
  createCurrenciesSchema,
  createPickupSchema,
  createStoreProfileSchema,
} from "@/lib/validation/catalog-settings";
import { createDeliveryAreaSchema } from "@/lib/validation/delivery";
import { createDeliveryChargesSchema, toDeliveryChargesInput } from "@/lib/validation/delivery-charges";
import { createFooterLinksSchema, createFooterSocialSchema, createFooterTextSchema } from "@/lib/validation/footer";
import {
  createCategory,
  deleteCategory,
  moveCategory,
  renameCategory,
  setCategoryVisibility,
} from "./categories";
import { setStoreCurrencies } from "./currencies";
import { saveDeliveryArea, saveDeliveryCharges } from "./delivery-settings";
import {
  updateFooterLinks,
  updateFooterSocial,
  updateFooterText,
  updatePickupSettings,
  updateStoreProfile,
} from "./store-settings";
import { getMerchantOrNull } from "./tenant";
import type { PermissionRequest } from "@/lib/permissions";

export type CatalogActionResult =
  | { ok: true }
  | {
      ok: false;
      error: "forbidden" | "notFound" | "failed" | "invalid" | "inUse" | "deliveryNeedsArea";
      fieldErrors?: Record<string, string[]>;
      codes?: string[];
    };

async function scopeIf(request: PermissionRequest) {
  const merchant = await getMerchantOrNull();
  if (!merchant || !merchant.can(request)) return null;
  return { tenantId: merchant.tenantId, storeId: merchant.store.id };
}

async function translator(locale: string) {
  return getTranslations({
    locale: hasLocale(routing.locales, locale) ? locale : routing.defaultLocale,
    namespace: "Validation",
  });
}

function invalid(error: z.ZodError): CatalogActionResult {
  return { ok: false, error: "invalid", fieldErrors: z.flattenError(error).fieldErrors as Record<string, string[]> };
}

/** Nested fields: keyed by their full path ("groups.0.links.2.url") so the form marks the right one. */
function invalidByPath(error: z.ZodError): CatalogActionResult {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) (fieldErrors[issue.path.join(".")] ??= []).push(issue.message);
  return { ok: false, error: "invalid", fieldErrors };
}

async function guard<T>(fn: () => Promise<T>): Promise<T | CatalogActionResult> {
  try {
    return await fn();
  } catch (error) {
    console.error("catalog action failed", error);
    return { ok: false, error: "failed" };
  }
}

// ---- categories (category:create / update / delete)

export async function createCategoryAction(values: unknown, locale: string): Promise<CatalogActionResult> {
  const scope = await scopeIf({ category: ["create"] });
  if (!scope) return { ok: false, error: "forbidden" };
  const parsed = createCategorySchema(await translator(locale)).safeParse(values);
  if (!parsed.success) return invalid(parsed.error);
  return guard(() => createCategory(scope, parsed.data)) as Promise<CatalogActionResult>;
}

export async function updateCategoryAction(id: unknown, values: unknown, locale: string): Promise<CatalogActionResult> {
  const scope = await scopeIf({ category: ["update"] });
  if (!scope) return { ok: false, error: "forbidden" };
  const parsedId = z.uuid().safeParse(id);
  if (!parsedId.success) return { ok: false, error: "notFound" };
  const parsed = createCategorySchema(await translator(locale)).safeParse(values);
  if (!parsed.success) return invalid(parsed.error);
  return guard(() => renameCategory(scope, parsedId.data, parsed.data)) as Promise<CatalogActionResult>;
}

export async function setCategoryVisibilityAction(id: unknown, visible: unknown): Promise<CatalogActionResult> {
  const scope = await scopeIf({ category: ["update"] });
  if (!scope) return { ok: false, error: "forbidden" };
  const parsedId = z.uuid().safeParse(id);
  if (!parsedId.success || typeof visible !== "boolean") return { ok: false, error: "notFound" };
  return guard(() => setCategoryVisibility(scope, parsedId.data, visible)) as Promise<CatalogActionResult>;
}

export async function moveCategoryAction(id: unknown, direction: unknown): Promise<CatalogActionResult> {
  const scope = await scopeIf({ category: ["update"] });
  if (!scope) return { ok: false, error: "forbidden" };
  const parsedId = z.uuid().safeParse(id);
  if (!parsedId.success || (direction !== "up" && direction !== "down")) return { ok: false, error: "notFound" };
  return guard(() => moveCategory(scope, parsedId.data, direction)) as Promise<CatalogActionResult>;
}

export async function deleteCategoryAction(id: unknown): Promise<CatalogActionResult> {
  const scope = await scopeIf({ category: ["delete"] });
  if (!scope) return { ok: false, error: "forbidden" };
  const parsedId = z.uuid().safeParse(id);
  if (!parsedId.success) return { ok: false, error: "notFound" };
  return guard(() => deleteCategory(scope, parsedId.data)) as Promise<CatalogActionResult>;
}

// ---- store settings (store:update)

export async function updateStoreProfileAction(values: unknown, locale: string): Promise<CatalogActionResult> {
  const scope = await scopeIf({ store: ["update"] });
  if (!scope) return { ok: false, error: "forbidden" };
  const parsed = createStoreProfileSchema(await translator(locale)).safeParse(values);
  if (!parsed.success) return invalid(parsed.error);
  return guard(async () => ((await updateStoreProfile(scope, parsed.data)) ? { ok: true } : { ok: false, error: "notFound" })) as Promise<CatalogActionResult>;
}

export async function updatePickupSettingsAction(values: unknown, locale: string): Promise<CatalogActionResult> {
  const scope = await scopeIf({ store: ["update"] });
  if (!scope) return { ok: false, error: "forbidden" };
  const parsed = createPickupSchema(await translator(locale)).safeParse(values);
  if (!parsed.success) return invalid(parsed.error);
  return guard(async () => ((await updatePickupSettings(scope, parsed.data)) ? { ok: true } : { ok: false, error: "notFound" })) as Promise<CatalogActionResult>;
}

export async function updateFooterTextAction(values: unknown, locale: string): Promise<CatalogActionResult> {
  const scope = await scopeIf({ store: ["update"] });
  if (!scope) return { ok: false, error: "forbidden" };
  const parsed = createFooterTextSchema(await translator(locale)).safeParse(values);
  if (!parsed.success) return invalid(parsed.error);
  return guard(async () => ((await updateFooterText(scope, parsed.data)) ? { ok: true } : { ok: false, error: "notFound" })) as Promise<CatalogActionResult>;
}

export async function updateFooterLinksAction(values: unknown, locale: string): Promise<CatalogActionResult> {
  const scope = await scopeIf({ store: ["update"] });
  if (!scope) return { ok: false, error: "forbidden" };
  const parsed = createFooterLinksSchema(await translator(locale)).safeParse(values);
  if (!parsed.success) return invalidByPath(parsed.error);
  return guard(async () => ((await updateFooterLinks(scope, parsed.data)) ? { ok: true } : { ok: false, error: "notFound" })) as Promise<CatalogActionResult>;
}

export async function updateFooterSocialAction(values: unknown, locale: string): Promise<CatalogActionResult> {
  const scope = await scopeIf({ store: ["update"] });
  if (!scope) return { ok: false, error: "forbidden" };
  const parsed = createFooterSocialSchema(await translator(locale)).safeParse(values);
  if (!parsed.success) return invalidByPath(parsed.error);
  return guard(async () => ((await updateFooterSocial(scope, parsed.data)) ? { ok: true } : { ok: false, error: "notFound" })) as Promise<CatalogActionResult>;
}

export async function saveDeliveryAreaAction(values: unknown, locale: string): Promise<CatalogActionResult> {
  const scope = await scopeIf({ store: ["update"] });
  if (!scope) return { ok: false, error: "forbidden" };
  const parsed = createDeliveryAreaSchema(await translator(locale)).safeParse(values);
  if (!parsed.success) return invalid(parsed.error);
  return guard(() => saveDeliveryArea(scope, parsed.data)) as Promise<CatalogActionResult>;
}

export async function saveDeliveryChargesAction(values: unknown, locale: string): Promise<CatalogActionResult> {
  const merchant = await getMerchantOrNull();
  if (!merchant || !merchant.can({ store: ["update"] })) return { ok: false, error: "forbidden" };
  const scope = { tenantId: merchant.tenantId, storeId: merchant.store.id };
  // The store's own currencies: amounts in any other currency are rejected
  const currencies = merchant.store.currencies;
  const parsed = createDeliveryChargesSchema(await translator(locale), currencies).safeParse(values);
  if (!parsed.success) return invalid(parsed.error);
  return guard(() => saveDeliveryCharges(scope, toDeliveryChargesInput(parsed.data, currencies))) as Promise<CatalogActionResult>;
}

export async function setStoreCurrenciesAction(values: unknown, locale: string): Promise<CatalogActionResult> {
  const scope = await scopeIf({ store: ["update"] });
  if (!scope) return { ok: false, error: "forbidden" };
  const parsed = createCurrenciesSchema(await translator(locale)).safeParse(values);
  if (!parsed.success) return invalid(parsed.error);
  return guard(async () => {
    const result = await setStoreCurrencies(scope, parsed.data.codes, parsed.data.defaultCode);
    return result.ok ? { ok: true } : { ok: false, error: result.error, codes: result.codes };
  }) as Promise<CatalogActionResult>;
}
