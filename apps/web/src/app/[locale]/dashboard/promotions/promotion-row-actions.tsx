"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useRouter } from "@/i18n/navigation";
import { useHydrated } from "@/lib/use-hydrated";
import { deletePromotionAction, setPromotionStatusAction } from "@/server/promotion-actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** Switch a promotion on/off and delete it (with confirmation). */
export function PromotionRowActions({
  id,
  name,
  active,
  canDelete,
}: {
  id: string;
  name: string;
  active: boolean;
  canDelete: boolean;
}) {
  const t = useTranslations("Promotions");
  const router = useRouter();
  const hydrated = useHydrated();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => ReturnType<typeof deletePromotionAction>, success: string) {
    setBusy(true);
    setError(null);
    const result = await action();
    setBusy(false);
    if (result.ok) toast.success(success);
    else setError(t(`errors.${result.error === "forbidden" ? "forbidden" : "failed"}`));
    router.refresh();
    return result.ok;
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-1">
        <Button
          size="sm"
          variant="outline"
          disabled={!hydrated || busy}
          onClick={() =>
            run(
              () => setPromotionStatusAction(id, active ? "draft" : "active"),
              t(active ? "toasts.paused" : "toasts.activated", { name }),
            )
          }
        >
          {active ? t("pause") : t("activate")}
        </Button>
        {canDelete && (
          <Button size="sm" variant="outline" disabled={!hydrated || busy} onClick={() => setConfirming(true)}>
            {t("delete")}
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}

      <Dialog open={confirming} onOpenChange={(open) => !busy && setConfirming(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("deleteTitle")}</DialogTitle>
            <DialogDescription>{t("deleteConfirm", { name })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setConfirming(false)}>
              {t("cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={async () => {
                if (await run(() => deletePromotionAction(id), t("toasts.deleted", { name }))) setConfirming(false);
              }}
            >
              {t("delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
