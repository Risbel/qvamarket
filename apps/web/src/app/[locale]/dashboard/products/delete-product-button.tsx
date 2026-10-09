"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { useHydrated } from "@/lib/use-hydrated";
import { deleteProductAction } from "@/server/product-actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function DeleteProductButton({ id, name }: { id: string; name: string }) {
  const t = useTranslations("Products.delete");
  const router = useRouter();
  const hydrated = useHydrated();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setPending(true);
    setError(null);
    const result = await deleteProductAction(id);
    // "notFound" = already gone: same outcome for the user
    if (result.ok || result.error === "notFound") {
      setOpen(false);
      router.refresh();
      return;
    }
    setError(t(`errors.${result.error === "forbidden" ? "forbidden" : "failed"}`));
    setPending(false);
  }

  return (
    <>
      <Button variant="outline" size="sm" disabled={!hydrated} onClick={() => setOpen(true)}>
        {t("button")}
      </Button>
      <Dialog open={open} onOpenChange={(next) => !pending && setOpen(next)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("title")}</DialogTitle>
            <DialogDescription>{t("confirm", { name })}</DialogDescription>
          </DialogHeader>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              {t("cancel")}
            </Button>
            <Button variant="destructive" onClick={confirm} disabled={pending}>
              {pending ? t("deleting") : t("confirmButton")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
