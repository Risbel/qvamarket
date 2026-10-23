"use server";

import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { routing } from "@/i18n/routing";
import { createExpenseSchema, toExpenseInput } from "@/lib/validation/expense";
import { createExpense, deleteExpense, updateExpense, type SaveExpenseResult } from "./expenses";
import { getMerchantOrNull } from "./tenant";

export type ExpenseActionResult =
  | { ok: true }
  | {
      ok: false;
      error: "forbidden" | "invalid" | "failed" | Extract<SaveExpenseResult, { ok: false }>["error"];
      fieldErrors?: Record<string, string[]>;
    };

type Merchant = NonNullable<Awaited<ReturnType<typeof getMerchantOrNull>>>;

/** Validates the raw form values with the same schema as the client (never trusted). */
async function parseValues(values: unknown, locale: string, merchant: Merchant) {
  const t = await getTranslations({
    locale: hasLocale(routing.locales, locale) ? locale : routing.defaultLocale,
    namespace: "Validation",
  });
  // The store's own currencies: an amount in any other currency is rejected here
  const currencies = merchant.store.currencies;
  const parsed = createExpenseSchema(t, currencies).safeParse(values);
  if (!parsed.success) {
    return {
      error: {
        ok: false,
        error: "invalid",
        fieldErrors: z.flattenError(parsed.error).fieldErrors as Record<string, string[]>,
      } satisfies ExpenseActionResult,
    };
  }
  return { data: toExpenseInput(parsed.data, currencies) };
}

const scopeOf = (merchant: Merchant) => ({ tenantId: merchant.tenantId, storeId: merchant.store.id });

export async function createExpenseAction(storeId: unknown, values: unknown, locale: string): Promise<ExpenseActionResult> {
  const merchant = await getMerchantOrNull(storeId);
  if (!merchant || !merchant.can({ expense: ["create"] })) return { ok: false, error: "forbidden" };
  const { data, error } = await parseValues(values, locale, merchant);
  if (error) return error;
  try {
    const result = await createExpense(scopeOf(merchant), data, merchant.session.user.id);
    return result.ok ? { ok: true } : result;
  } catch (e) {
    console.error("createExpenseAction failed", e);
    return { ok: false, error: "failed" };
  }
}

export async function updateExpenseAction(
  storeId: unknown,
  id: unknown,
  values: unknown,
  locale: string,
): Promise<ExpenseActionResult> {
  const merchant = await getMerchantOrNull(storeId);
  if (!merchant || !merchant.can({ expense: ["update"] })) return { ok: false, error: "forbidden" };
  const parsedId = z.uuid().safeParse(id);
  if (!parsedId.success) return { ok: false, error: "notFound" };
  const { data, error } = await parseValues(values, locale, merchant);
  if (error) return error;
  try {
    const result = await updateExpense(scopeOf(merchant), parsedId.data.toLowerCase(), data);
    return result.ok ? { ok: true } : result;
  } catch (e) {
    console.error("updateExpenseAction failed", e);
    return { ok: false, error: "failed" };
  }
}

export async function deleteExpenseAction(storeId: unknown, id: unknown): Promise<ExpenseActionResult> {
  const merchant = await getMerchantOrNull(storeId);
  if (!merchant || !merchant.can({ expense: ["delete"] })) return { ok: false, error: "forbidden" };
  const parsedId = z.uuid().safeParse(id);
  if (!parsedId.success) return { ok: false, error: "notFound" };
  try {
    return await deleteExpense(scopeOf(merchant), parsedId.data.toLowerCase());
  } catch (e) {
    console.error("deleteExpenseAction failed", e);
    return { ok: false, error: "failed" };
  }
}
