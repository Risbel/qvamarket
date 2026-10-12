import type { PhoneCountry } from "./countries";

/**
 * Phone number as the customer typed it -> the form we store and match customers by.
 *
 * - International ("+53 5 555-1234", "0053 5 5551234"): "+" and the digits, as typed.
 * - National ("5 555 1234", "07 123 4567") with a `country`: its calling code is added and its
 *   trunk prefix dropped ("+5355551234", "+5371234567"), so the same person is found again
 *   however they write it.
 * - National without a country: just the digits (cannot be completed).
 *
 * null when it is not a plausible number (same rule as the `customer_phone_format` check).
 */
export function normalizePhone(input: string, country?: PhoneCountry | null): string | null {
  const trimmed = input.trim();
  if (!/^\+?[0-9\s().-]+$/.test(trimmed)) return null;
  let digits = trimmed.replace(/\D/g, "");

  let phone: string;
  if (trimmed.startsWith("+")) {
    phone = `+${digits}`;
  } else if (digits.startsWith("00")) {
    phone = `+${digits.slice(2)}`;
  } else if (country) {
    if (country.trunk && digits.startsWith(country.trunk)) digits = digits.slice(country.trunk.length);
    phone = `+${country.dial}${digits}`;
  } else {
    phone = digits;
  }
  return /^\+?[0-9]{6,20}$/.test(phone) ? phone : null;
}
