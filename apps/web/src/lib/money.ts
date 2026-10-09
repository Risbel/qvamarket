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
 * with string arithmetic so there is no floating point rounding.
 */
export function parsePriceToMinor(input: string, digits: number): number | null {
  const text = input.trim();
  const pattern = digits === 0 ? /^\d+$/ : new RegExp(`^\\d+([.,]\\d{1,${digits}})?$`);
  if (!pattern.test(text)) return null;
  const [whole, fraction = ""] = text.replace(",", ".").split(".");
  const minor = Number(whole) * 10 ** digits + Number(fraction.padEnd(digits, "0") || 0);
  return Number.isSafeInteger(minor) && minor <= MAX_PRICE_MINOR ? minor : null;
}

/** Integer minor units -> the plain decimal string shown in the price input ("19.99"). */
export function minorToInput(minor: number, digits: number): string {
  if (digits === 0) return String(minor);
  const padded = String(minor).padStart(digits + 1, "0");
  return `${padded.slice(0, -digits)}.${padded.slice(-digits)}`;
}
