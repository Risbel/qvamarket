"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

/** A country as the selects show it; built on the server with phoneCountryOptions(locale). */
export type CountryOption = { code: string; dial: string; name: string };

/**
 * Country picker (shadcn Select): each option is "Cuba +53". `compact` shows only "CU +53"
 * in the trigger (next to a phone field). No flags for now.
 */
export function CountrySelect({
  value,
  onValueChange,
  options,
  placeholder,
  noneLabel,
  compact = false,
  id,
  name,
  disabled,
  invalid,
  className,
  "aria-label": ariaLabel,
}: {
  /** "" = nothing selected */
  value: string;
  onValueChange: (code: string) => void;
  options: CountryOption[];
  placeholder: string;
  /** when set, an extra first option that clears the choice */
  noneLabel?: string;
  compact?: boolean;
  id?: string;
  name?: string;
  disabled?: boolean;
  invalid?: boolean;
  className?: string;
  "aria-label"?: string;
}) {
  const byCode = new Map(options.map((option) => [option.code, option]));
  const NONE = "__none__";

  return (
    <Select
      value={value || null}
      onValueChange={(next) => onValueChange(typeof next === "string" && next !== NONE ? next : "")}
      name={name}
      disabled={disabled}
    >
      <SelectTrigger id={id} aria-label={ariaLabel} aria-invalid={invalid || undefined} className={cn(compact ? "shrink-0" : "w-full", className)}>
        <SelectValue placeholder={placeholder}>
          {(code: string | null) => {
            const option = code ? byCode.get(code) : undefined;
            if (!option) return placeholder;
            return compact ? `${option.code} +${option.dial}` : `${option.name} +${option.dial}`;
          }}
        </SelectValue>
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false} align="start" className="w-auto min-w-56">
        {noneLabel && <SelectItem value={NONE}>{noneLabel}</SelectItem>}
        {options.map((option) => (
          <SelectItem key={option.code} value={option.code}>
            <span className="flex w-full justify-between gap-4">
              <span>{option.name}</span>
              <span className="text-muted-foreground tabular-nums">+{option.dial}</span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
