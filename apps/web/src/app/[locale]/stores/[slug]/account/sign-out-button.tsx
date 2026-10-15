"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useRouter } from "@/i18n/navigation";
import { useHydrated } from "@/lib/use-hydrated";
import { customerSignOutAction } from "@/server/customer-account-actions";
import { Button } from "@/components/ui/button";

/** Signs out of this store only (each store subdomain has its own session). */
export function SignOutButton() {
  const t = useTranslations("Store.account");
  const router = useRouter();
  const hydrated = useHydrated();
  const [busy, setBusy] = useState(false);

  return (
    <Button
      variant="outline"
      disabled={!hydrated || busy}
      onClick={async () => {
        setBusy(true);
        await customerSignOutAction().catch(() => null);
        toast.success(t("toasts.signedOut"));
        router.replace("/");
        router.refresh();
      }}
    >
      {t("signOut")}
    </Button>
  );
}
