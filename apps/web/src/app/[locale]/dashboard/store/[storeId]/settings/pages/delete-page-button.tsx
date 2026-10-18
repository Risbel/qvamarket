"use client";

import { useStoreId } from "@/components/panel-scope";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useRouter } from "@/i18n/navigation";
import { useHydrated } from "@/lib/use-hydrated";
import { deleteStorePageAction } from "@/server/store-page-actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** Deletes a custom page after confirmation. */
export function DeletePageButton({ id, title }: { id: string; title: string }) {
  const storeId = useStoreId();
  const t = useTranslations("Settings.pages");
  const router = useRouter();
  const hydrated = useHydrated();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onDelete() {
    setBusy(true);
    setError(null);
    const result = await deleteStorePageAction(storeId, id);
    setBusy(false);
    if (!result.ok) {
      setError(t(`errors.${result.error === "forbidden" ? "forbidden" : "failed"}`));
      return;
    }
    toast.success(t("toasts.deleted", { title }));
    setConfirming(false);
    router.refresh();
  }

  return (
    <>
      <Button size="sm" variant="outline" disabled={!hydrated || busy} onClick={() => setConfirming(true)}>
        {t("delete")}
      </Button>
      <Dialog open={confirming} onOpenChange={(open) => !busy && setConfirming(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("deleteTitle")}</DialogTitle>
            <DialogDescription>{t("deleteConfirm", { title })}</DialogDescription>
          </DialogHeader>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setConfirming(false)}>
              {t("cancel")}
            </Button>
            <Button variant="destructive" disabled={busy} onClick={onDelete}>
              {t("delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
