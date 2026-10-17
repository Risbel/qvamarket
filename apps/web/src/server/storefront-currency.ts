import { cookies, headers } from "next/headers";
import type { StoreCurrency } from "./currencies";

/**
 * The shopper's chosen currency lives in a host-only cookie, so every store subdomain keeps
 * its own choice. Anything that is not one of the store's currencies falls back to the
 * store's default.
 */
export const CURRENCY_COOKIE = "qvashop_currency";

/** Eurozone members plus the countries that use the euro without being members. */
const EURO_COUNTRIES = new Set([
  "AT", "BE", "BG", "CY", "DE", "EE", "ES", "FI", "FR", "GR", "HR", "IE", "IT", "LT", "LU",
  "LV", "MT", "NL", "PT", "SI", "SK", "AD", "MC", "ME", "SM", "VA", "XK",
]);

export function pickCurrency(currencies: StoreCurrency[], requested: string | null | undefined): StoreCurrency {
  const fallback = currencies.find((c) => c.isDefault) ?? currencies[0];
  return currencies.find((c) => c.code === requested) ?? fallback;
}

/**
 * The currency to show a shopper who has not picked one yet, from their IP's country: CUP in
 * Cuba, otherwise EUR in euro countries and USD elsewhere (whichever the store sells). Null
 * when the country is unknown or the store sells none of them (the store's default applies).
 */
export function currencyForCountry(currencies: StoreCurrency[], country: string | null | undefined): StoreCurrency | null {
  const code = country?.toUpperCase();
  // Cloudflare sends XX for an unknown country and T1 for Tor
  if (!code || !/^[A-Z]{2}$/.test(code) || code === "XX" || code === "T1") return null;
  const sold = (c: string) => currencies.find((x) => x.code === c) ?? null;
  if (code === "CU") return sold("CUP");
  if (EURO_COUNTRIES.has(code)) return sold("EUR") ?? sold("USD");
  return sold("USD") ?? sold("EUR");
}

/** The visitor's country: Cloudflare's header in production; DEV_VISITOR_COUNTRY in dev. */
async function visitorCountry(): Promise<string | null> {
  const header = (await headers()).get("cf-ipcountry");
  if (header) return header;
  return process.env.NODE_ENV === "production" ? null : (process.env.DEV_VISITOR_COUNTRY ?? null);
}

/**
 * The shopper's own choice (cookie) always wins. Without one, the currency follows the
 * visitor's country; it is not saved, so only an explicit choice sticks.
 */
export async function selectedCurrency(currencies: StoreCurrency[]): Promise<StoreCurrency> {
  const requested = (await cookies()).get(CURRENCY_COOKIE)?.value;
  const chosen = currencies.find((c) => c.code === requested);
  if (chosen) return chosen;
  return currencyForCountry(currencies, await visitorCountry()) ?? pickCurrency(currencies, null);
}
