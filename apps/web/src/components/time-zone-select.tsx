"use client";

import { useMemo } from "react";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import type { TimeZoneOption } from "@/lib/time-zones";

/**
 * Searchable timezone picker (shadcn Combobox on Base UI): type part of the name
 * ("havana", "madrid") to filter. Options come from timeZoneOptions() on the server.
 */
export function TimeZoneSelect({
  id,
  value,
  onValueChange,
  options,
  placeholder,
  emptyText,
  disabled,
  invalid,
}: {
  id?: string;
  value: string;
  onValueChange: (zone: string) => void;
  options: TimeZoneOption[];
  placeholder: string;
  emptyText: string;
  disabled?: boolean;
  invalid?: boolean;
}) {
  // A zone missing from the list (e.g. an alias the runtime resolves differently) is still shown
  const selected = useMemo(
    () => options.find((option) => option.value === value) ?? (value ? { value, label: value.replaceAll("_", " "), offset: "" } : null),
    [options, value],
  );

  return (
    <Combobox
      items={options}
      value={selected}
      onValueChange={(next: TimeZoneOption | null) => {
        if (next) onValueChange(next.value);
      }}
      itemToStringLabel={(option: TimeZoneOption) => option.label}
      itemToStringValue={(option: TimeZoneOption) => option.value}
      isItemEqualToValue={(a: TimeZoneOption, b: TimeZoneOption) => a.value === b.value}
      disabled={disabled}
    >
      <ComboboxInput id={id} placeholder={placeholder} aria-invalid={invalid || undefined} disabled={disabled} className="w-full" />
      <ComboboxContent>
        <ComboboxEmpty>{emptyText}</ComboboxEmpty>
        <ComboboxList>
          {(option: TimeZoneOption) => (
            <ComboboxItem key={option.value} value={option}>
              <span className="flex w-full justify-between gap-4">
                <span>{option.label}</span>
                <span className="text-muted-foreground tabular-nums">{option.offset}</span>
              </span>
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
