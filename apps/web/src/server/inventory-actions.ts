"use server";

import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { routing } from "@/i18n/routing";
import { parsePriceToMinor } from "@/lib/money";
import { createCostSchema, createStockAdjustmentSchema } from "@/lib/validation/inventory";
import type { InventoryReason } from "@/lib/inventory";
import { adjustStock, setVariantCost, type AdjustStockResult } from "./inventory";
import { getMerchantOrNull } from "./tenant";

export type InventoryActionResult =
  | { ok: true }
  | {
      ok: false;
      error: "forbidden" | "invalid" | "failed" | Extract<AdjustStockResult, { ok: false }>["error"];
      fieldErrors?: Record<string, string[]>;
    };

async function translator(locale: string) {
  return getTranslations({
    locale: hasLocale(routing.locales, locale) ? locale : routing.defaultLocale,
    namespace: "Validation",
  });
}

/** Both actions need inventory:update; the store's base currency is the cost currency. */
async function merchantWithUpdate(storeId: unknown) {
  const merchant = await getMerchantOrNull(storeId);
  return merchant && merchant.can({ inventory: ["update"] }) ? merchant : null;
}

const invalid = (error: z.ZodError): InventoryActionResult => ({
  ok: false,
  error: "invalid",
  fieldErrors: z.flattenError(error).fieldErrors as Record<string, string[]>,
});

/** Adds, removes or counts the stock of one tracked variant (`expectedStock` = what the form showed). */
export async function adjustStockAction(
  storeId: unknown,
  variantId: unknown,
  expectedStock: unknown,
  values: unknown,
  locale: string,
): Promise<InventoryActionResult> {
  const merchant = await merchantWithUpdate(storeId);
  if (!merchant) return { ok: false, error: "forbidden" };
  const id = z.uuid().safeParse(variantId);
  if (!id.success) return { ok: false, error: "notFound" };
  const expected = z.number().int().min(0).safeParse(expectedStock);
  if (!expected.success) return { ok: false, error: "stale" };
  const base = merchant.store.baseCurrency;
  const parsed = createStockAdjustmentSchema(await translator(locale), { stock: expected.data, digits: base.digits }).safeParse(values);
  if (!parsed.success) return invalid(parsed.error);
  const { mode, reason, quantity, unitCost, note } = parsed.data;

  try {
    const result = await adjustStock(
      { tenantId: merchant.tenantId, storeId: merchant.store.id },
      {
        variantId: id.data.toLowerCase(),
        expectedStock: expected.data,
        mode,
        // checked against the mode by the schema
        reason: reason as InventoryReason,
        quantity: Number(quantity),
        unitCostMinor: reason === "received" && unitCost !== "" ? parsePriceToMinor(unitCost, base.digits) : null,
        baseCurrencyCode: base.code,
        note: note || null,
        userId: merchant.session.user.id,
      },
    );
    return result.ok ? { ok: true } : result;
  } catch (error) {
    console.error("adjustStockAction failed", error);
    return { ok: false, error: "failed" };
  }
}

/** Sets a variant's unit cost in the base currency ("" clears it). */
export async function setVariantCostAction(
  storeId: unknown,
  variantId: unknown,
  values: unknown,
  locale: string,
): Promise<InventoryActionResult> {
  const merchant = await merchantWithUpdate(storeId);
  if (!merchant) return { ok: false, error: "forbidden" };
  const id = z.uuid().safeParse(variantId);
  if (!id.success) return { ok: false, error: "notFound" };
  const base = merchant.store.baseCurrency;
  const parsed = createCostSchema(await translator(locale), base.digits).safeParse(values);
  if (!parsed.success) return invalid(parsed.error);

  try {
    const found = await setVariantCost(
      { tenantId: merchant.tenantId, storeId: merchant.store.id },
      id.data.toLowerCase(),
      parsed.data.cost === "" ? null : parsePriceToMinor(parsed.data.cost, base.digits),
      base.code,
    );
    return found ? { ok: true } : { ok: false, error: "notFound" };
  } catch (error) {
    console.error("setVariantCostAction failed", error);
    return { ok: false, error: "failed" };
  }
}
