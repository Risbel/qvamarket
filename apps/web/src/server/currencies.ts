import {
  and,
  asc,
  count,
  countDistinct,
  currency,
  db,
  desc,
  eq,
  inArray,
  productVariant,
  sql,
  store,
  storeCurrency,
  variantPrice,
} from "@qvashop/db";
import { belowLimit, planLimitError, type PlanKey, type PlanLimitError } from "@/lib/plans";
import { normalizeRate, roundingSteps } from "@/lib/exchange";

export type StoreCurrency = {
  code: string;
  digits: number;
  isDefault: boolean;
  /** the currency the merchant types prices in */
  isBase: boolean;
  /** units of this currency per 1 base unit (decimal string); null = only manual prices */
  rate: string | null;
  /** automatic prices are a multiple of this (minor units); null = 1 */
  roundingMinor: number | null;
};

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
 * filtered by the store id only, which is not secret. Rates are public too: they only
 * explain prices the storefront shows anyway.
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
      isBase: storeCurrency.isBase,
      rate: storeCurrency.exchangeRate,
      roundingMinor: storeCurrency.roundingMinor,
    })
    .from(storeCurrency)
    .innerJoin(currency, eq(currency.code, storeCurrency.currencyCode))
    .where(inArray(storeCurrency.storeId, storeIds))
    .orderBy(desc(storeCurrency.isDefault), asc(storeCurrency.position), asc(storeCurrency.currencyCode));
  for (const { storeId, ...row } of rows) {
    const list = result.get(storeId) ?? [];
    list.push({ ...row, rate: row.rate === null ? null : normalizeRate(row.rate) });
    result.set(storeId, list);
  }
  return result;
}

type Scope = { tenantId: string; storeId: string };

export type CurrencySettings = {
  /** enabled currencies, in display order */
  codes: string[];
  defaultCode: string;
  baseCode: string;
  /** per currency: rate per 1 base unit (normalized decimal string) or null; ignored for the base */
  rates: Record<string, string | null>;
  /** per currency: rounding step of automatic prices in minor units, or null */
  rounding: Record<string, number | null>;
};

export type SetCurrenciesResult =
  | { ok: true }
  | PlanLimitError
  | { ok: false; error: "invalid" }
  | { ok: false; error: "inUse"; codes: string[] }
  | { ok: false; error: "baseMissingPrices"; count: number };

/**
 * Replaces the store's currencies, its default and base currency and the rates. `codes` must
 * be active platform currencies and include both the default and the base. A currency that
 * still has prices of its own cannot be removed (we report which ones instead of letting the
 * FK fail). Changing the base is refused while some product has a regular price in the old
 * base but none in the new one (it would lose its prices everywhere): `count` products.
 */
export async function setStoreCurrencies(
  scope: Scope,
  plan: PlanKey,
  settings: CurrencySettings,
): Promise<SetCurrenciesResult> {
  const unique = [...new Set(settings.codes)];
  if (unique.length === 0 || !unique.includes(settings.defaultCode) || !unique.includes(settings.baseCode)) {
    return { ok: false, error: "invalid" };
  }

  const active = await db
    .select({ code: currency.code, digits: currency.digits })
    .from(currency)
    .where(and(eq(currency.isActive, true), inArray(currency.code, unique)));
  if (active.length !== unique.length) return { ok: false, error: "invalid" };
  // A rounding step must be one the form offers for that currency
  for (const { code, digits } of active) {
    const step = settings.rounding[code];
    if (step != null && !roundingSteps(digits).includes(step)) return { ok: false, error: "invalid" };
  }

  return db.transaction(async (tx): Promise<SetCurrenciesResult> => {
    // Serializes with checkouts and other settings saves of this store
    await tx
      .select({ id: store.id })
      .from(store)
      .where(and(eq(store.id, scope.storeId), eq(store.tenantId, scope.tenantId)))
      .for("no key update");

    const current = await tx
      .select({ code: storeCurrency.currencyCode, isBase: storeCurrency.isBase })
      .from(storeCurrency)
      .where(and(eq(storeCurrency.storeId, scope.storeId), eq(storeCurrency.tenantId, scope.tenantId)));
    const removed = current.map((c) => c.code).filter((code) => !unique.includes(code));
    // Past the plan's limit only removing is allowed (a store above it after a downgrade keeps its currencies)
    if (unique.length > current.length && !belowLimit(plan, "currencies", unique.length - 1)) {
      return planLimitError(plan, "currencies");
    }

    if (removed.length > 0) {
      const inUse = await tx
        .select({ code: variantPrice.currencyCode, total: count() })
        .from(variantPrice)
        .where(and(eq(variantPrice.storeId, scope.storeId), inArray(variantPrice.currencyCode, removed)))
        .groupBy(variantPrice.currencyCode);
      if (inUse.length > 0) return { ok: false, error: "inUse", codes: inUse.map((r) => r.code) };
    }

    const oldBase = current.find((c) => c.isBase)?.code;
    if (oldBase && oldBase !== settings.baseCode) {
      // Raw subqueries name product_variant explicitly (see the Drizzle gotcha in CLAUDE.md)
      const regularIn = (code: string) => sql`exists (
        select 1 from variant_price vp
        where vp.variant_id = product_variant.id and vp.tenant_id = product_variant.tenant_id
          and vp.currency_code = ${code} and vp.price_list_id is null and vp.min_quantity = 1)`;
      const [{ missing }] = await tx
        .select({ missing: countDistinct(productVariant.productId) })
        .from(productVariant)
        .where(
          and(
            eq(productVariant.storeId, scope.storeId),
            eq(productVariant.tenantId, scope.tenantId),
            regularIn(oldBase),
            sql`not ${regularIn(settings.baseCode)}`,
          ),
        );
      if (missing > 0) return { ok: false, error: "baseMissingPrices", count: missing };
    }

    if (removed.length > 0) {
      await tx
        .delete(storeCurrency)
        .where(and(eq(storeCurrency.storeId, scope.storeId), inArray(storeCurrency.currencyCode, removed)));
    }

    // Clear the flags first: only one row may be the default (and the base) at any moment
    await tx
      .update(storeCurrency)
      .set({ isDefault: false, isBase: false })
      .where(and(eq(storeCurrency.storeId, scope.storeId), eq(storeCurrency.tenantId, scope.tenantId)));

    for (const [position, code] of unique.entries()) {
      const isBase = code === settings.baseCode;
      const values = {
        isDefault: code === settings.defaultCode,
        isBase,
        exchangeRate: isBase ? null : (settings.rates[code] ?? null),
        roundingMinor: isBase ? null : (settings.rounding[code] ?? null),
        position,
      };
      await tx
        .insert(storeCurrency)
        .values({ storeId: scope.storeId, tenantId: scope.tenantId, currencyCode: code, ...values })
        .onConflictDoUpdate({ target: [storeCurrency.storeId, storeCurrency.currencyCode], set: values });
    }
    return { ok: true };
  });
}
