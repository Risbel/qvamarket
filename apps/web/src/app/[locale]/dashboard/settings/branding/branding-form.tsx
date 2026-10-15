"use client";

import { useMemo, useState } from "react";
import { Controller, useForm, type Control } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { useRouter } from "@/i18n/navigation";
import { HEX_COLOR } from "@/lib/color";
import { useHydrated } from "@/lib/use-hydrated";
import { createBrandingSchema, type BrandingValues } from "@/lib/validation/branding";
import { updateBrandingAction } from "@/server/branding-actions";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { BrandPreview } from "./brand-preview";

export function BrandingForm({
  initialValues,
  storeName,
  logoUrl,
  logotypeUrl,
}: {
  initialValues: BrandingValues;
  storeName: string;
  logoUrl: string | null;
  logotypeUrl: string | null;
}) {
  const t = useTranslations("Branding");
  const tv = useTranslations("Validation");
  const locale = useLocale();
  const router = useRouter();
  const hydrated = useHydrated();
  const [formError, setFormError] = useState<string | null>(null);

  const schema = useMemo(() => createBrandingSchema(tv), [tv]);
  const form = useForm<BrandingValues>({
    resolver: zodResolver(schema),
    defaultValues: initialValues,
  });

  const primary = form.watch("primaryColor");
  const accent = form.watch("accentColor");
  const validPrimary = HEX_COLOR.test(primary.toLowerCase()) ? primary.toLowerCase() : initialValues.primaryColor;
  const validAccent = HEX_COLOR.test(accent.toLowerCase()) ? accent.toLowerCase() : initialValues.accentColor;

  async function onSubmit(values: BrandingValues) {
    setFormError(null);
    const result = await updateBrandingAction(values, locale);
    if (result.ok) {
      toast.success(t("saved"));
      router.refresh();
      return;
    }
    if (result.error === "invalid") {
      for (const [name, messages] of Object.entries(result.fieldErrors ?? {})) {
        form.setError(name as keyof BrandingValues, { message: messages[0] });
      }
      return;
    }
    setFormError(t(`errors.${result.error === "forbidden" ? "forbidden" : "failed"}`));
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} method="post" noValidate>
      <FieldGroup>
        <ColorField
          control={form.control}
          name="primaryColor"
          label={t("colors.primary")}
          pickerLabel={t("colors.picker", { label: t("colors.primary") })}
          help={t("colors.primaryHelp")}
        />
        <ColorField
          control={form.control}
          name="accentColor"
          label={t("colors.accent")}
          pickerLabel={t("colors.picker", { label: t("colors.accent") })}
          help={t("colors.accentHelp")}
        />

        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">{t("preview.title")}</span>
          <BrandPreview
            name={storeName}
            logoUrl={logoUrl}
            logotypeUrl={logotypeUrl}
            primary={validPrimary}
            accent={validAccent}
            buttonLabel={t("preview.button")}
            badgeLabel={t("preview.badge")}
          />
        </div>

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

function ColorField({
  control,
  name,
  label,
  pickerLabel,
  help,
}: {
  control: Control<BrandingValues>;
  name: keyof BrandingValues;
  label: string;
  /** Distinct accessible name for the native color picker (the hex field already has `label`) */
  pickerLabel: string;
  help: string;
}) {
  return (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid}>
          <FieldLabel htmlFor={name}>{label}</FieldLabel>
          <div className="flex items-center gap-2">
            <input
              type="color"
              aria-label={pickerLabel}
              value={HEX_COLOR.test(field.value.toLowerCase()) ? field.value.toLowerCase() : "#000000"}
              onChange={(event) => field.onChange(event.target.value)}
              className="size-8 shrink-0 cursor-pointer rounded-md border border-input bg-transparent p-0.5"
            />
            <Input
              {...field}
              id={name}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={fieldState.invalid}
              className="max-w-40 font-mono"
            />
          </div>
          <FieldDescription>{help}</FieldDescription>
          <FieldError errors={[fieldState.error]} />
        </Field>
      )}
    />
  );
}
