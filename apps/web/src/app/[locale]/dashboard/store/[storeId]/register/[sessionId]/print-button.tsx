"use client";

import { PrinterIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useHydrated } from "@/lib/use-hydrated";
import { Button } from "@/components/ui/button";

/** Prints the report (the panel's navigation is hidden with print: utilities). */
export function PrintButton() {
  const t = useTranslations("Register.report");
  const hydrated = useHydrated();
  return (
    <Button variant="outline" size="sm" disabled={!hydrated} onClick={() => window.print()}>
      <PrinterIcon />
      {t("print")}
    </Button>
  );
}
