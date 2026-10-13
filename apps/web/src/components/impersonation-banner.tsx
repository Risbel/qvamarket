"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { stopImpersonationAction } from "@/server/impersonation-actions";
import { useHydrated } from "@/lib/use-hydrated";
import { Button } from "@/components/ui/button";

/**
 * Shown on every signed-in page while a superadmin is impersonating a merchant
 * (render it when `session.session.impersonatedBy` is set).
 */
export function ImpersonationBanner({ targetEmail }: { targetEmail: string }) {
  const t = useTranslations("Impersonation");
  const router = useRouter();
  const hydrated = useHydrated();
  const [pending, setPending] = useState(false);

  async function stop() {
    setPending(true);
    const result = await stopImpersonationAction();
    if (result.ok) {
      router.push("/admin");
      router.refresh();
      return;
    }
    setPending(false);
  }

  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-center gap-3 bg-amber-100 px-4 py-2 text-sm text-amber-950 dark:bg-amber-950 dark:text-amber-100"
    >
      <span>{t("viewingAs", { email: targetEmail })}</span>
      <Button size="sm" variant="outline" disabled={!hydrated || pending} onClick={stop}>
        {t("stop")}
      </Button>
    </div>
  );
}
