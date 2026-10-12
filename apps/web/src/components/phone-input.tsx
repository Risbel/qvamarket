"use client";

import type { ComponentProps } from "react";
import { Input } from "@/components/ui/input";
import { CountrySelect, type CountryOption } from "./country-select";

/**
 * Phone field with its country: the country's calling code is added on the server to a
 * number typed without "+" (normalizePhone). A number typed with "+" or "00" keeps its own
 * code, whatever the country says.
 */
export function PhoneInput({
  country,
  onCountryChange,
  options,
  countryLabel,
  countryPlaceholder,
  invalid,
  ...inputProps
}: Omit<ComponentProps<typeof Input>, "type"> & {
  country: string;
  onCountryChange: (code: string) => void;
  options: CountryOption[];
  countryLabel: string;
  countryPlaceholder: string;
  invalid?: boolean;
}) {
  return (
    <div className="flex gap-2">
      <CountrySelect
        compact
        value={country}
        onValueChange={onCountryChange}
        options={options}
        placeholder={countryPlaceholder}
        aria-label={countryLabel}
        disabled={inputProps.disabled}
      />
      <Input {...inputProps} type="tel" inputMode="tel" aria-invalid={invalid || undefined} className="min-w-0 flex-1" />
    </div>
  );
}
