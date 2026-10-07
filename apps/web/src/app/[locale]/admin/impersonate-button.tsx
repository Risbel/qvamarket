"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { startImpersonationAction } from "@/server/impersonation-actions";
import { useHydrated } from "@/lib/use-hydrated";
import { Button } from "@/components/ui/button";

export function ImpersonateButton({ userId }: { userId: string }) {
  const t = useTranslations("Admin.impersonate");
  const router = useRouter();
  const hydrated = useHydrated();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setPending(true);
    setError(null);
    const result = await startImpersonationAction(userId);
    if (result.ok) {
      router.push("/dashboard");
      router.refresh();
      return;
    }
    setError(t(`errors.${result.error}`));
    setPending(false);
  }

  return (
    <>
      <Button size="sm" disabled={!hydrated || pending} onClick={start}>
        {pending ? t("starting") : t("button")}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </>
  );
}
