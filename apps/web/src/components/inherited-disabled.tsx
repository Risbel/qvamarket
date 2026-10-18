"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * Disabled state handed down to controls that a native `<fieldset disabled>` does not reach.
 * Base UI's Switch, Checkbox and Radio render a `<span>`, and the Dropzone takes drops on a
 * `<label>`, so they read this too (see components/ui). <PermissionFieldset> sets it; nested
 * providers can only add to it, never re-enable.
 */
const InheritedDisabledContext = createContext(false);

export function InheritedDisabled({ disabled, children }: { disabled: boolean; children: ReactNode }) {
  const parent = useContext(InheritedDisabledContext);
  return <InheritedDisabledContext value={parent || disabled}>{children}</InheritedDisabledContext>;
}

export function useInheritedDisabled() {
  return useContext(InheritedDisabledContext);
}
