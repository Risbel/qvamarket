"use client";

import { useEffect, useMemo, useState } from "react";
import { Controller, useForm, useWatch, type Path } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { PlusIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { useOrgId } from "@/components/panel-scope";
import { useRouter } from "@/i18n/navigation";
import { storePath } from "@/lib/panel-paths";
import { slugify } from "@/lib/slug";
import { useHydrated } from "@/lib/use-hydrated";
import { createNewStoreSchema, type NewStoreValues } from "@/lib/validation/store";
import { createStoreAction } from "@/server/company-store-actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

const DEFAULT_VALUES: NewStoreValues = { storeName: "", storeSlug: "" };

/**
 * Creates a store in the company (owners only; the server checks it again). The store starts
 * pending until the superadmin approves it; the merchant lands on its panel to set it up.
 * `url` = the public address around the subdomain, e.g. ["https://", ".qvashop.com"].
 */
export function CreateStoreDialog({ url }: { url: [string, string] }) {
  const orgId = useOrgId();
  const t = useTranslations("Stores.create");
  const tv = useTranslations("Validation");
  const locale = useLocale();
  const router = useRouter();
  const hydrated = useHydrated();
  const [open, setOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const schema = useMemo(() => createNewStoreSchema(tv), [tv]);
  const form = useForm<NewStoreValues>({ resolver: zodResolver(schema), defaultValues: DEFAULT_VALUES });

  // Suggest the subdomain from the store name until the merchant edits it
  const storeName = useWatch({ control: form.control, name: "storeName" });
  const storeSlug = useWatch({ control: form.control, name: "storeSlug" });
  const slugDirty = form.formState.dirtyFields.storeSlug;
  useEffect(() => {
    if (!slugDirty) form.setValue("storeSlug", slugify(storeName));
  }, [storeName, slugDirty, form]);

  function onOpenChange(next: boolean) {
    if (form.formState.isSubmitting) return;
    setOpen(next);
    if (!next) {
      setFormError(null);
      form.reset(DEFAULT_VALUES);
    }
  }

  async function onSubmit(values: NewStoreValues) {
    setFormError(null);
    const result = await createStoreAction(orgId, values, locale).catch(() => null);
    if (result?.ok) {
      toast.success(t("toasts.created", { name: values.storeName.trim() }));
      router.push(storePath(result.storeId));
      return;
    }
    switch (result?.error) {
      case "invalid":
        for (const [field, messages] of Object.entries(result.fieldErrors ?? {})) {
          form.setError(field as Path<NewStoreValues>, { message: messages[0] });
        }
        return;
      case "slugTaken":
        form.setError("storeSlug", { message: tv("slugTaken") });
        return;
      case "limit":
      case "forbidden":
        setFormError(t(`errors.${result.error}`));
        return;
      default:
        setFormError(t("errors.failed"));
    }
  }

  return (
    <>
      <Button disabled={!hydrated} onClick={() => setOpen(true)}>
        <PlusIcon />
        {t("button")}
      </Button>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <form onSubmit={form.handleSubmit(onSubmit)} method="post" noValidate className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>{t("title")}</DialogTitle>
              <DialogDescription>{t("description")}</DialogDescription>
            </DialogHeader>
            <FieldGroup>
              <Controller
                name="storeName"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor="store-name">{t("name")}</FieldLabel>
                    <Input
                      {...field}
                      id="store-name"
                      autoComplete="off"
                      placeholder={t("namePlaceholder")}
                      aria-invalid={fieldState.invalid}
                    />
                    <FieldError errors={[fieldState.error]} />
                  </Field>
                )}
              />
              <Controller
                name="storeSlug"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor="store-slug">{t("slug")}</FieldLabel>
                    <Input
                      {...field}
                      id="store-slug"
                      autoComplete="off"
                      autoCapitalize="none"
                      placeholder={t("slugPlaceholder")}
                      aria-invalid={fieldState.invalid}
                    />
                    <FieldDescription>
                      {t("slugHelp", { url: `${url[0]}${storeSlug || t("slugPlaceholder")}${url[1]}` })}
                    </FieldDescription>
                    <FieldError errors={[fieldState.error]} />
                  </Field>
                )}
              />
              <p className="text-sm text-muted-foreground">{t("approvalNotice")}</p>
              {formError && <FieldError>{formError}</FieldError>}
            </FieldGroup>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {t("cancel")}
              </Button>
              <Button type="submit" disabled={!hydrated || form.formState.isSubmitting}>
                {form.formState.isSubmitting ? t("submitting") : t("submit")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
