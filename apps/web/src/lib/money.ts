/** Number of decimal places of a currency (2 for USD, 0 for JPY, 3 for KWD, ...). */
export function currencyDigits(currency: string): number {
  return (
    new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions()
      .maximumFractionDigits ?? 2
  );
}

/** Integer minor units (e.g. cents) -> localized price string. Never use floats for storage. */
export function formatMoney(minor: number, currency: string, locale: string): string {
  const digits = currencyDigits(currency);
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(
    minor / 10 ** digits,
  );
}

/** Largest price we accept, in minor units (fits PostgreSQL integer with plenty of room). */
export const MAX_PRICE_MINOR = 1_000_000_000;

/**
 * What a merchant types ("19.99", "19,99", "1500") -> integer minor units, or null when
 * invalid. Plain decimal only (no thousands separators), at most `digits` decimals, done
 * with string arithmetic so there is no floating point rounding. Prices are capped at
 * MAX_PRICE_MINOR; other amounts (e.g. a payment of a large order) pass their own `max`.
 */
export function parsePriceToMinor(input: string, digits: number, max = MAX_PRICE_MINOR): number | null {
  const text = input.trim();
  const pattern = digits === 0 ? /^\d+$/ : new RegExp(`^\\d+([.,]\\d{1,${digits}})?$`);
  if (!pattern.test(text)) return null;
  const [whole, fraction = ""] = text.replace(",", ".").split(".");
  const minor = Number(whole) * 10 ** digits + Number(fraction.padEnd(digits, "0") || 0);
  return Number.isSafeInteger(minor) && minor <= max ? minor : null;
}

/** Integer minor units -> the plain decimal string shown in the price input ("19.99"). */
export function minorToInput(minor: number, digits: number): string {
  if (digits === 0) return String(minor);
  const padded = String(minor).padStart(digits + 1, "0");
  return `${padded.slice(0, -digits)}.${padded.slice(-digits)}`;
}

/** Allowed change of a bulk price adjustment, in percent (products table). */
export const ADJUST_MIN_PERCENT = -90;
export const ADJUST_MAX_PERCENT = 1000;

/**
 * A typed percentage ("10", "-5", "2.5", "2,5") -> basis points (1000 = 10 %), or null when
 * invalid, zero or outside ADJUST_MIN_PERCENT..ADJUST_MAX_PERCENT. String arithmetic, no floats.
 */
export function parsePercent(input: string): number | null {
  const text = input.trim().replace(/^\+/, "").replace(",", ".");
  const match = /^(-?)(\d{1,4})(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) return null;
  const magnitude = Number(match[2]) * 100 + Number((match[3] ?? "").padEnd(2, "0"));
  const basisPoints = match[1] ? -magnitude : magnitude;
  if (basisPoints === 0 || basisPoints < ADJUST_MIN_PERCENT * 100 || basisPoints > ADJUST_MAX_PERCENT * 100) return null;
  return basisPoints;
}
