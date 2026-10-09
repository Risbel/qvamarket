"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { useHydrated } from "@/lib/use-hydrated";
import { setStoreStatusAction } from "@/server/merchant-actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Status = "pending" | "active" | "suspended";

/**
 * Approve (pending -> active), suspend (active -> suspended, with a confirmation because the
 * public storefront disappears) or reactivate (suspended -> active) a store.
 */
export function StoreStatusControls({
  storeId,
  storeName,
  status,
}: {
  storeId: string;
  storeName: string;
  status: Status;
}) {
  const t = useTranslations("Admin.storeStatus");
  const router = useRouter();
  const hydrated = useHydrated();
  const [pending, setPending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function change(next: Status) {
    setPending(true);
    setError(null);
    const result = await setStoreStatusAction(storeId, next);
    setPending(false);
    if (result.ok) {
      setConfirming(false);
      router.refresh();
      return;
    }
    setError(t(`errors.${result.error}`));
  }

  return (
    <>
      {status === "pending" && (
        <Button size="sm" disabled={!hydrated || pending} onClick={() => change("active")}>
          {t("approve")}
        </Button>
      )}
      {status === "suspended" && (
        <Button size="sm" disabled={!hydrated || pending} onClick={() => change("active")}>
          {t("reactivate")}
        </Button>
      )}
      {status === "active" && (
        <Button
          size="sm"
          variant="outline"
          disabled={!hydrated || pending}
          onClick={() => setConfirming(true)}
        >
          {t("suspend")}
        </Button>
      )}
      {error && !confirming && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <Dialog open={confirming} onOpenChange={(open) => !pending && setConfirming(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("suspendTitle")}</DialogTitle>
            <DialogDescription>{t("suspendConfirm", { name: storeName })}</DialogDescription>
          </DialogHeader>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" disabled={pending} onClick={() => setConfirming(false)}>
              {t("cancel")}
            </Button>
            <Button variant="destructive" disabled={pending} onClick={() => change("suspended")}>
              {pending ? t("suspending") : t("suspendButton")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
