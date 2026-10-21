"use client";

import { useState } from "react";
import { SearchIcon } from "lucide-react";
import { useDebouncedCallback } from "use-debounce";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";

/**
 * Search box of a server-driven table. The list follows the typing (debounced); it is also a
 * GET form, so Enter works even before hydration (the other params ride along hidden).
 */
export function Search({
  value,
  hidden,
  maxLength,
  label,
  placeholder,
  onChange,
}: {
  value: string;
  /** the list's other params, kept by the GET form */
  hidden: Record<string, string>;
  maxLength: number;
  label: string;
  placeholder: string;
  onChange: (query: string) => void;
}) {
  const [text, setText] = useState(value);
  const [shown, setShown] = useState(value);
  const debounced = useDebouncedCallback((query: string) => onChange(query.trim()), 400);

  // The URL changed elsewhere (reset, back button): show its query, unless the merchant is
  // still typing (a newer search is on its way)
  if (value !== shown) {
    setShown(value);
    if (!debounced.isPending() && value !== text.trim()) setText(value);
  }

  return (
    <form
      method="get"
      role="search"
      className="w-full sm:w-64"
      onSubmit={(event) => {
        event.preventDefault();
        debounced.flush();
      }}
    >
      {Object.entries(hidden).map(([name, val]) => (
        <input key={name} type="hidden" name={name} value={val} />
      ))}
      <InputGroup>
        <InputGroupAddon>
          <SearchIcon />
        </InputGroupAddon>
        <InputGroupInput
          name="q"
          type="search"
          value={text}
          maxLength={maxLength}
          onChange={(event) => {
            setText(event.target.value);
            debounced(event.target.value);
          }}
          placeholder={placeholder}
          aria-label={label}
        />
      </InputGroup>
    </form>
  );
}
