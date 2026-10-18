"use client";

import { useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { Trash2Icon } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useRouter } from "@/i18n/navigation";
import { useHydrated } from "@/lib/use-hydrated";
import { deleteStoreAction } from "@/server/merchant-actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

type Values = { confirmation: string };

/**
 * Superadmin: deletes a store for good (rows and files). The subdomain must be typed to
 * enable the button; the server checks it again.
 */
export function DeleteStoreDialog({ storeId, storeName, slug }: { storeId: string; storeName: string; slug: string }) {
  const t = useTranslations("Admin.deleteStore");
  const router = useRouter();
  const hydrated = useHydrated();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const form = useForm<Values>({ defaultValues: { confirmation: "" } });
  const typed = useWatch({ control: form.control, name: "confirmation" });
  const matches = typed.trim().toLowerCase() === slug;

  function onOpenChange(next: boolean) {
    if (form.formState.isSubmitting) return;
    setOpen(next);
    if (!next) {
      setError(null);
      form.reset();
    }
  }

  async function onSubmit({ confirmation }: Values) {
    setError(null);
    const result = await deleteStoreAction(storeId, confirmation).catch(() => null);
    if (result?.ok) {
      toast.success(t("toasts.deleted", { name: result.name }));
      setOpen(false);
      form.reset();
      router.refresh();
      return;
    }
    setError(t(`errors.${result?.error ?? "failed"}`));
  }

  return (
    <>
      <Button size="sm" variant="destructive" disabled={!hydrated} onClick={() => setOpen(true)}>
        <Trash2Icon />
        {t("button")}
      </Button>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <form onSubmit={form.handleSubmit(onSubmit)} method="post" noValidate className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>{t("title", { name: storeName })}</DialogTitle>
              <DialogDescription>{t("description")}</DialogDescription>
            </DialogHeader>
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              <li>{t("removes.catalog")}</li>
              <li>{t("removes.orders")}</li>
              <li>{t("removes.settings")}</li>
              <li>{t("removes.files")}</li>
            </ul>
            <p className="text-sm text-muted-foreground">{t("keeps")}</p>
            <FieldGroup>
              <Controller
                name="confirmation"
                control={form.control}
                render={({ field }) => (
                  <Field>
                    <FieldLabel htmlFor={`delete-${storeId}`}>{t("confirmLabel", { slug })}</FieldLabel>
                    <Input
                      {...field}
                      id={`delete-${storeId}`}
                      autoComplete="off"
                      autoCapitalize="none"
                      spellCheck={false}
                      placeholder={slug}
                    />
                  </Field>
                )}
              />
              {error && <FieldError>{error}</FieldError>}
            </FieldGroup>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {t("cancel")}
              </Button>
              <Button
                type="submit"
                variant="destructive"
                disabled={!hydrated || !matches || form.formState.isSubmitting}
              >
                {form.formState.isSubmitting ? t("deleting") : t("submit")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
