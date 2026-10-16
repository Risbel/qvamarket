"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useRouter } from "@/i18n/navigation";
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

/** Confirmation dialog for deleting a product; opened by its owner (e.g. the row actions menu). */
export function DeleteProductDialog({
  id,
  name,
  open,
  onOpenChange,
}: {
  id: string;
  name: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("Products.delete");
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close(next: boolean) {
    if (pending) return;
    if (!next) setError(null);
    onOpenChange(next);
  }

  async function confirm() {
    setPending(true);
    setError(null);
    const result = await deleteProductAction(id);
    // "notFound" = already gone: same outcome for the user
    if (result.ok || result.error === "notFound") {
      toast.success(t("toasts.deleted", { name }));
      setPending(false);
      onOpenChange(false);
      router.refresh();
      return;
    }
    setError(t(`errors.${result.error === "forbidden" ? "forbidden" : "failed"}`));
    setPending(false);
  }

  return (
    <Dialog open={open} onOpenChange={close}>
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
          <Button variant="outline" onClick={() => close(false)} disabled={pending}>
            {t("cancel")}
          </Button>
          <Button variant="destructive" onClick={confirm} disabled={pending}>
            {pending ? t("deleting") : t("confirmButton")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
