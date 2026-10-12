// Countries for phone numbers (no library). Names come from Intl.DisplayNames, so they follow
// the page locale. To add a country: its ISO 3166-1 alpha-2 code, its calling code, and the
// national trunk prefix people type at home before the number, if it has one ("0" in Cuba or
// the UK, "1" in the US). Italy has none on purpose: its leading 0 is part of the number.

export const PHONE_COUNTRIES = [
  { code: "CU", dial: "53", trunk: "0" },
  { code: "US", dial: "1", trunk: "1" },
  { code: "ES", dial: "34" },
  { code: "FR", dial: "33", trunk: "0" },
  { code: "IT", dial: "39" },
] as const satisfies readonly { code: string; dial: string; trunk?: string }[];

export type PhoneCountryCode = (typeof PHONE_COUNTRIES)[number]["code"];
export type PhoneCountry = { code: PhoneCountryCode; dial: string; trunk?: string };

export function findPhoneCountry(code: unknown): PhoneCountry | null {
  return PHONE_COUNTRIES.find((country) => country.code === code) ?? null;
}

export function isPhoneCountryCode(code: unknown): code is PhoneCountryCode {
  return findPhoneCountry(code) !== null;
}

/** The countries with their names in `locale`, sorted by name (for selects). */
export function phoneCountryOptions(locale: string) {
  const names = new Intl.DisplayNames([locale], { type: "region" });
  return PHONE_COUNTRIES.map((country) => ({ ...country, name: names.of(country.code) ?? country.code })).sort((a, b) =>
    a.name.localeCompare(b.name, locale),
  );
}
