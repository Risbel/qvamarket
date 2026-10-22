import { PHONE_COUNTRIES, type PhoneCountry } from "./countries";

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

/**
 * A stored number back into what a phone field shows: its country and the rest of the number
 * ("+5354353930" -> CU, "54353930"). A number in another country ("+44...") keeps its "+" with
 * no country; one saved without "+" (typed before numbers were normalized) gets `fallback`.
 */
export function splitPhone(stored: string | null | undefined, fallback: string): { country: string; national: string } {
  if (!stored) return { country: fallback, national: "" };
  if (!stored.startsWith("+")) return { country: fallback, national: stored };
  const country = PHONE_COUNTRIES.find((candidate) => stored.startsWith(`+${candidate.dial}`));
  return country ? { country: country.code, national: stored.slice(country.dial.length + 1) } : { country: "", national: stored };
}
