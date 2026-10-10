/**
 * Phone number as the customer typed it -> the form we store and match customers by:
 * digits with an optional leading "+" ("+53 5 555-1234" -> "+5355551234"). null when it is
 * not a plausible number (same rule as the `customer_phone_format` check in the database).
 *
 * No country rules: "55551234" and "+5355551234" are different keys for now.
 */
export function normalizePhone(input: string): string | null {
  const trimmed = input.trim();
  if (!/^\+?[0-9\s().-]+$/.test(trimmed)) return null;
  const digits = trimmed.replace(/\D/g, "");
  const phone = (trimmed.startsWith("+") ? "+" : "") + digits;
  return /^\+?[0-9]{6,20}$/.test(phone) ? phone : null;
}
