"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useRouter } from "@/i18n/navigation";
import { useHydrated } from "@/lib/use-hydrated";
import { runBillingJobAction } from "@/server/billing-actions";
import { Button } from "@/components/ui/button";

/** Runs the daily billing job now (renewal invoices, trials, pauses, past due, expired). */
export function RunJobButton() {
  const t = useTranslations("Billing.job");
  const router = useRouter();
  const hydrated = useHydrated();
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    const result = await runBillingJobAction().catch(() => null);
    setBusy(false);
    if (result?.ok && "invoices" in result) {
      toast.success(t("done", { invoices: result.invoices, moves: result.moves }));
      router.refresh();
    } else {
      toast.error(t("failed"));
    }
  }

  return (
    <Button variant="outline" disabled={!hydrated || busy} onClick={run}>
      {busy ? t("running") : t("run")}
    </Button>
  );
}
