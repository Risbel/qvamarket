import { and, asc, count, db, desc, eq, inArray, currency, storeCurrency, variantPrice } from "@qvashop/db";

export type StoreCurrency = { code: string; digits: number; isDefault: boolean };

/** Currencies the platform offers to stores (superadmin can deactivate some). */
export async function listActiveCurrencies() {
  return db
    .select({ code: currency.code, name: currency.name, digits: currency.digits })
    .from(currency)
    .where(eq(currency.isActive, true))
    .orderBy(asc(currency.code));
}

/**
 * Currencies one store sells in, default first. Public data (used by the storefront too):
 * filtered by the store id only, which is not secret.
 */
export async function getStoreCurrencies(storeIds: string[]): Promise<Map<string, StoreCurrency[]>> {
  const result = new Map<string, StoreCurrency[]>();
  if (storeIds.length === 0) return result;
  const rows = await db
    .select({
      storeId: storeCurrency.storeId,
      code: storeCurrency.currencyCode,
      digits: currency.digits,
      isDefault: storeCurrency.isDefault,
    })
    .from(storeCurrency)
    .innerJoin(currency, eq(currency.code, storeCurrency.currencyCode))
    .where(inArray(storeCurrency.storeId, storeIds))
    .orderBy(desc(storeCurrency.isDefault), asc(storeCurrency.position), asc(storeCurrency.currencyCode));
  for (const row of rows) {
    const list = result.get(row.storeId) ?? [];
    list.push({ code: row.code, digits: row.digits, isDefault: row.isDefault });
    result.set(row.storeId, list);
  }
  return result;
}

type Scope = { tenantId: string; storeId: string };

export type SetCurrenciesResult =
  | { ok: true }
  | { ok: false; error: "invalid" | "inUse"; codes?: string[] };

/**
 * Replaces the store's currencies. `codes` must be active platform currencies and include
 * `defaultCode`. A currency that still has prices cannot be removed (the merchant must delete
 * those prices first): we report which ones instead of letting the FK fail.
 */
export async function setStoreCurrencies(
  scope: Scope,
  codes: string[],
  defaultCode: string,
): Promise<SetCurrenciesResult> {
  const unique = [...new Set(codes)];
  if (unique.length === 0 || !unique.includes(defaultCode)) return { ok: false, error: "invalid" };

  const active = await db
    .select({ code: currency.code })
    .from(currency)
    .where(and(eq(currency.isActive, true), inArray(currency.code, unique)));
  if (active.length !== unique.length) return { ok: false, error: "invalid" };

  return db.transaction(async (tx) => {
    const current = await tx
      .select({ code: storeCurrency.currencyCode })
      .from(storeCurrency)
      .where(and(eq(storeCurrency.storeId, scope.storeId), eq(storeCurrency.tenantId, scope.tenantId)));
    const removed = current.map((c) => c.code).filter((code) => !unique.includes(code));

    if (removed.length > 0) {
      const inUse = await tx
        .select({ code: variantPrice.currencyCode, total: count() })
        .from(variantPrice)
        .where(and(eq(variantPrice.storeId, scope.storeId), inArray(variantPrice.currencyCode, removed)))
        .groupBy(variantPrice.currencyCode);
      if (inUse.length > 0) return { ok: false, error: "inUse", codes: inUse.map((r) => r.code) } as const;
      await tx
        .delete(storeCurrency)
        .where(and(eq(storeCurrency.storeId, scope.storeId), inArray(storeCurrency.currencyCode, removed)));
    }

    // Clear the default first: only one row may be the default at any moment
    await tx
      .update(storeCurrency)
      .set({ isDefault: false })
      .where(and(eq(storeCurrency.storeId, scope.storeId), eq(storeCurrency.tenantId, scope.tenantId)));

    for (const [position, code] of unique.entries()) {
      await tx
        .insert(storeCurrency)
        .values({
          storeId: scope.storeId,
          tenantId: scope.tenantId,
          currencyCode: code,
          isDefault: code === defaultCode,
          position,
        })
        .onConflictDoUpdate({
          target: [storeCurrency.storeId, storeCurrency.currencyCode],
          set: { isDefault: code === defaultCode, position },
        });
    }
    return { ok: true } as const;
  });
}
