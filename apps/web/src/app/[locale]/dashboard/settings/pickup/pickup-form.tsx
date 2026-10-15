"use client";

import { useMemo, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { useRouter } from "@/i18n/navigation";
import { useHydrated } from "@/lib/use-hydrated";
import { createPickupSchema, type PickupValues } from "@/lib/validation/catalog-settings";
import { updatePickupSettingsAction } from "@/server/catalog-actions";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";

export function PickupForm({ initialValues }: { initialValues: PickupValues }) {
  const t = useTranslations("Settings.pickup");
  const tv = useTranslations("Validation");
  const locale = useLocale();
  const router = useRouter();
  const hydrated = useHydrated();
  const [formError, setFormError] = useState<string | null>(null);
  const schema = useMemo(() => createPickupSchema(tv), [tv]);
  const form = useForm<PickupValues>({ resolver: zodResolver(schema), defaultValues: initialValues });

  async function onSubmit(values: PickupValues) {
    setFormError(null);
    const result = await updatePickupSettingsAction(values, locale);
    if (result.ok) {
      toast.success(t("saved"));
      router.refresh();
    } else if (result.error === "invalid") {
      for (const [field, messages] of Object.entries(result.fieldErrors ?? {})) {
        form.setError(field as keyof PickupValues, { message: messages[0] });
      }
    } else {
      setFormError(t(`errors.${result.error === "forbidden" ? "forbidden" : "failed"}`));
    }
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} method="post" noValidate>
      <FieldGroup>
        <Controller
          name="pickupInstructions"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor="pickupInstructions">{t("instructions")}</FieldLabel>
              <Textarea {...field} id="pickupInstructions" rows={4} aria-invalid={fieldState.invalid} />
              <FieldDescription>{t("instructionsHelp")}</FieldDescription>
              <FieldError errors={[fieldState.error]} />
            </Field>
          )}
        />
        {formError && (
          <p role="alert" className="text-sm text-destructive">
            {formError}
          </p>
        )}
        <div>
          <Button type="submit" disabled={!hydrated || form.formState.isSubmitting}>
            {form.formState.isSubmitting ? t("saving") : t("save")}
          </Button>
        </div>
      </FieldGroup>
    </form>
  );
}
