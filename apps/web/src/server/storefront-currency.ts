import { cookies } from "next/headers";
import type { StoreCurrency } from "./currencies";

/**
 * The shopper's chosen currency lives in a host-only cookie, so every store subdomain keeps
 * its own choice. Anything that is not one of the store's currencies falls back to the
 * store's default.
 */
export const CURRENCY_COOKIE = "qvashop_currency";

export function pickCurrency(currencies: StoreCurrency[], requested: string | null | undefined): StoreCurrency {
  const fallback = currencies.find((c) => c.isDefault) ?? currencies[0];
  return currencies.find((c) => c.code === requested) ?? fallback;
}

export async function selectedCurrency(currencies: StoreCurrency[]): Promise<StoreCurrency> {
  return pickCurrency(currencies, (await cookies()).get(CURRENCY_COOKIE)?.value);
}
