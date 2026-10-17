// Automatic prices in other currencies (pure, shared by server and browser).
//
// A store types its prices in ONE currency, the base (store_currency.is_base). Every other
// currency can have an exchange rate ("1 USD = 800 CUP"). A variant that has no prices of
// its own (manual prices) in such a currency is sold there at its base prices x rate, rounded
// to the currency's step. Nothing is stored for automatic prices: changing the rate changes
// every automatic price at once. Orders keep a snapshot, so old orders never change.
//
// Each group of prices is decided separately: the regular prices (price_list_id null, with
// their tiers) and each promotion (price list). A group with rows in the currency is manual
// there; otherwise it follows the base rows of the same group.
//
// Money stays in integer minor units; the conversion uses BigInt (no floating point).

export type FxCurrency = {
  code: string;
  digits: number;
  isBase: boolean;
  /** units of this currency for 1 unit of the base, as a decimal string; null = no automatic prices */
  rate: string | null;
  /** automatic prices are a multiple of this (minor units); null = 1 */
  roundingMinor: number | null;
};

/** Decimals kept for a rate (the DB column is numeric(20, 8)). */
export const RATE_DECIMALS = 8;
/** "800", "0.83", "1,2" (up to 12 digits before the point and 8 after it). */
export const RATE_PATTERN = /^\d{1,12}([.,]\d{1,8})?$/;
// BigInt() calls instead of literals: the TypeScript target is below ES2020
const [ZERO, TWO, TEN] = [BigInt(0), BigInt(2), BigInt(10)];
const RATE_SCALE = TEN ** BigInt(RATE_DECIMALS);

/** A typed or stored rate -> integer scaled by 10^8, or null when invalid or not positive. */
export function parseRate(input: string): bigint | null {
  const text = input.trim();
  if (!RATE_PATTERN.test(text)) return null;
  const [whole, fraction = ""] = text.replace(",", ".").split(".");
  const scaled = BigInt(whole) * RATE_SCALE + BigInt(fraction.padEnd(RATE_DECIMALS, "0"));
  return scaled > ZERO ? scaled : null;
}

/** Normalized rate string ("800.00000000" or "800,5" -> "800" / "800.5"), or null when invalid. */
export function normalizeRate(input: string): string | null {
  const scaled = parseRate(input);
  if (scaled === null) return null;
  const whole = scaled / RATE_SCALE;
  const fraction = (scaled % RATE_SCALE).toString().padStart(RATE_DECIMALS, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : `${whole}`;
}

/**
 * Rounding steps a merchant can choose for a currency, in minor units: from the smallest
 * unit (no rounding) up to 100 major units (e.g. CUP: 0.01, 0.05, ... 10, 50, 100).
 */
export function roundingSteps(digits: number): number[] {
  const max = 100 * 10 ** digits;
  const steps: number[] = [];
  for (let unit = 1; unit <= max; unit *= 10) {
    steps.push(unit);
    if (unit * 5 <= max) steps.push(unit * 5);
  }
  return steps;
}

/**
 * A base amount -> the same amount in `target`, at its rate, rounded half up to its step.
 * Null when the target has no rate or the result is too large to handle safely. A positive
 * amount never rounds down to 0 (it becomes one step): rounding must not make things free.
 */
export function convertMinor(
  amountMinor: number,
  base: Pick<FxCurrency, "digits">,
  target: Pick<FxCurrency, "digits" | "rate" | "roundingMinor">,
): number | null {
  if (target.rate === null) return null;
  const rate = parseRate(target.rate);
  if (rate === null) return null;
  const step = BigInt(target.roundingMinor ?? 1);
  const numerator = BigInt(amountMinor) * rate * TEN ** BigInt(target.digits);
  const denominator = RATE_SCALE * TEN ** BigInt(base.digits) * step;
  let result = ((TWO * numerator + denominator) / (TWO * denominator)) * step;
  if (amountMinor > 0 && result === ZERO) result = step;
  return result <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(result) : null;
}

export type DerivableRow = {
  currencyCode: string;
  minQuantity: number;
  amountMinor: number;
  compareAtMinor: number | null;
  priceListId: string | null;
};

/**
 * The price rows of ONE variant in `target`, from its rows in the target and base currencies
 * (other currencies are ignored). Groups (regular prices, each promotion) with their own rows
 * in the target keep them (`auto: false`); the others are converted from the base (`auto:
 * true`) when the target has a rate. A converted "was" price is dropped when rounding leaves
 * it no higher than the price.
 */
export function pricesIn<T extends DerivableRow>(
  rows: T[],
  target: FxCurrency,
  base: FxCurrency,
): (T & { auto: boolean })[] {
  const own = rows.filter((row) => row.currencyCode === target.code);
  if (target.code === base.code) return own.map((row) => ({ ...row, auto: false }));

  const manualGroups = new Set(own.map((row) => row.priceListId));
  const result: (T & { auto: boolean })[] = own.map((row) => ({ ...row, auto: false }));
  if (target.rate === null) return result;

  for (const row of rows) {
    if (row.currencyCode !== base.code || manualGroups.has(row.priceListId)) continue;
    const amountMinor = convertMinor(row.amountMinor, base, target);
    if (amountMinor === null) continue;
    const compareAt = row.compareAtMinor === null ? null : convertMinor(row.compareAtMinor, base, target);
    result.push({
      ...row,
      currencyCode: target.code,
      amountMinor,
      compareAtMinor: compareAt !== null && compareAt > amountMinor ? compareAt : null,
      auto: true,
    });
  }
  return result;
}

/** True when the variant's regular prices in `currencyCode` are its own (manual). */
export function hasManualPrices(rows: DerivableRow[], currencyCode: string): boolean {
  return rows.some((row) => row.currencyCode === currencyCode && row.priceListId === null);
}

/**
 * Rates re-expressed for a new base (the merchant changes the base in the form): with the
 * old rates r (per 1 old base), a currency Y is worth r(Y) / r(newBase) per new base, and the
 * old base 1 / r(newBase). Without a rate for the new base nothing can be converted (all null).
 * Display values: the merchant sees them and can adjust before saving.
 */
export function rebaseRates(
  rates: Record<string, string | null>,
  oldBase: string,
  newBase: string,
): Record<string, string | null> {
  const pivot = rates[newBase] ? Number(rates[newBase]!.replace(",", ".")) : NaN;
  const result: Record<string, string | null> = {};
  for (const code of Object.keys(rates)) {
    if (code === newBase) result[code] = null;
    else if (!Number.isFinite(pivot) || pivot <= 0) result[code] = null;
    else if (code === oldBase) result[code] = formatRate(1 / pivot);
    else {
      const own = rates[code] ? Number(rates[code]!.replace(",", ".")) : NaN;
      result[code] = Number.isFinite(own) && own > 0 ? formatRate(own / pivot) : null;
    }
  }
  return result;
}

/** A computed rate -> at most 8 decimals, no trailing zeros, null when it rounds to 0. */
function formatRate(value: number): string | null {
  const text = value.toFixed(RATE_DECIMALS).replace(/\.?0+$/, "");
  return text === "0" ? null : normalizeRate(text);
}
