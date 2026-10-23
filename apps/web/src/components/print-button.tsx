"use client";

import { PrinterIcon } from "lucide-react";
import { useHydrated } from "@/lib/use-hydrated";
import { Button } from "@/components/ui/button";

/** Prints the page (the panel's navigation is hidden with print: utilities). */
export function PrintButton({ label, autoFocus }: { label: string; autoFocus?: boolean }) {
  const hydrated = useHydrated();
  return (
    <Button variant="outline" size="sm" disabled={!hydrated} autoFocus={autoFocus} onClick={() => window.print()}>
      <PrinterIcon />
      {label}
    </Button>
  );
}
