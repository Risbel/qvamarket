"use client";

import { PlanFeatureGate } from "@/components/plans/plan-feature-gate";
import { useStoreId } from "@/components/panel-scope";
import { useMemo, useState } from "react";
import { Controller, useForm, type Control } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { useRouter } from "@/i18n/navigation";
import { HEX_COLOR } from "@/lib/color";
import { baseSwatches, THEME_BASES, THEME_RADII } from "@/lib/store-theme";
import { useHydrated } from "@/lib/use-hydrated";
import { createBrandingSchema, type BrandingValues } from "@/lib/validation/branding";
import { updateBrandingAction } from "@/server/branding-actions";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldTitle,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
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
  const storeId = useStoreId();
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
  const [radius, base, tinted] = form.watch(["radius", "base", "tinted"]);
  const validPrimary = HEX_COLOR.test(primary.toLowerCase()) ? primary.toLowerCase() : initialValues.primaryColor;
  const validAccent = HEX_COLOR.test(accent.toLowerCase()) ? accent.toLowerCase() : initialValues.accentColor;

  async function onSubmit(values: BrandingValues) {
    setFormError(null);
    const result = await updateBrandingAction(storeId, values, locale);
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
          placeholder={t("colors.placeholder")}
        />
        <ColorField
          control={form.control}
          name="accentColor"
          label={t("colors.accent")}
          pickerLabel={t("colors.picker", { label: t("colors.accent") })}
          help={t("colors.accentHelp")}
          placeholder={t("colors.placeholder")}
        />

        {/* the theme options are a plan feature: saved only with it (the colors are on every plan) */}
        <PlanFeatureGate feature="theme">
        <Controller
          name="base"
          control={form.control}
          render={({ field }) => (
            <FieldSet>
              <FieldLegend variant="label">{t("theme.base")}</FieldLegend>
              <FieldDescription>{t("theme.baseHelp")}</FieldDescription>
              <RadioGroup
                value={field.value}
                onValueChange={field.onChange}
                className="grid-cols-2 sm:grid-cols-3 lg:grid-cols-5"
              >
                {THEME_BASES.map((option) => (
                  <FieldLabel key={option} htmlFor={`base-${option}`}>
                    <Field orientation="horizontal">
                      <FieldContent className="gap-2">
                        <FieldTitle>{t(`theme.bases.${option}`)}</FieldTitle>
                        <span className="flex" aria-hidden>
                          {baseSwatches(option).map((color) => (
                            <span
                              key={color}
                              className="size-4 rounded-full border border-background not-first:-ml-1"
                              style={{ backgroundColor: color }}
                            />
                          ))}
                        </span>
                      </FieldContent>
                      <RadioGroupItem value={option} id={`base-${option}`} />
                    </Field>
                  </FieldLabel>
                ))}
              </RadioGroup>
            </FieldSet>
          )}
        />

        <Controller
          name="radius"
          control={form.control}
          render={({ field }) => (
            <FieldSet>
              <FieldLegend variant="label">{t("theme.radius")}</FieldLegend>
              <FieldDescription>{t("theme.radiusHelp")}</FieldDescription>
              <RadioGroup
                value={field.value}
                onValueChange={field.onChange}
                className="grid-cols-3 sm:grid-cols-6"
              >
                {THEME_RADII.map((option) => (
                  <FieldLabel key={option} htmlFor={`radius-${option}`}>
                    <Field orientation="horizontal">
                      <FieldContent className="gap-2">
                        <span
                          aria-hidden
                          className="size-6 border-t-2 border-l-2 border-foreground/70"
                          style={{ borderTopLeftRadius: `${Number(option) * 1.4}rem` }}
                        />
                        <FieldTitle>{option}</FieldTitle>
                      </FieldContent>
                      <RadioGroupItem value={option} id={`radius-${option}`} aria-label={t("theme.radiusOption", { value: option })} />
                    </Field>
                  </FieldLabel>
                ))}
              </RadioGroup>
            </FieldSet>
          )}
        />

        <Controller
          name="tinted"
          control={form.control}
          render={({ field }) => (
            <Field orientation="horizontal">
              <FieldContent>
                <FieldLabel htmlFor="theme-tinted">{t("theme.tinted")}</FieldLabel>
                <FieldDescription>{t("theme.tintedHelp")}</FieldDescription>
              </FieldContent>
              <Switch id="theme-tinted" checked={field.value} onCheckedChange={field.onChange} />
            </Field>
          )}
        />
        </PlanFeatureGate>

        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">{t("preview.title")}</span>
          <BrandPreview
            name={storeName}
            logoUrl={logoUrl}
            logotypeUrl={logotypeUrl}
            theme={{ primary: validPrimary, accent: validAccent, radius, base, tinted }}
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
  placeholder,
}: {
  control: Control<BrandingValues>;
  name: "primaryColor" | "accentColor";
  label: string;
  /** Distinct accessible name for the native color picker (the hex field already has `label`) */
  pickerLabel: string;
  help: string;
  placeholder: string;
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
              placeholder={placeholder}
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
