"use client";

import { useStoreId } from "@/components/panel-scope";
import { useMemo, useState } from "react";
import { Controller, useForm, type Control } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { useRouter } from "@/i18n/navigation";
import { useHydrated } from "@/lib/use-hydrated";
import { createStoreProfileSchema, type StoreProfileValues } from "@/lib/validation/catalog-settings";
import { updateStoreProfileAction } from "@/server/catalog-actions";
import { CountrySelect, type CountryOption } from "@/components/country-select";
import { TimeZoneSelect } from "@/components/time-zone-select";
import { canonicalTimeZone } from "@/lib/date-range";
import type { TimeZoneOption } from "@/lib/time-zones";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export function StoreProfileForm({
  initialValues,
  countries,
  timeZones,
}: {
  initialValues: StoreProfileValues;
  countries: CountryOption[];
  timeZones: TimeZoneOption[];
}) {
  const storeId = useStoreId();
  const t = useTranslations("Settings.profile");
  const tv = useTranslations("Validation");
  const locale = useLocale();
  const router = useRouter();
  const hydrated = useHydrated();
  const [formError, setFormError] = useState<string | null>(null);
  const schema = useMemo(() => createStoreProfileSchema(tv), [tv]);
  const form = useForm<StoreProfileValues>({ resolver: zodResolver(schema), defaultValues: initialValues });

  async function onSubmit(values: StoreProfileValues) {
    setFormError(null);
    const result = await updateStoreProfileAction(storeId, values, locale);
    if (result.ok) {
      toast.success(t("saved"));
      router.refresh();
    } else if (result.error === "invalid") {
      for (const [field, messages] of Object.entries(result.fieldErrors ?? {})) {
        form.setError(field as keyof StoreProfileValues, { message: messages[0] });
      }
    } else {
      setFormError(t(`errors.${result.error === "forbidden" ? "forbidden" : "failed"}`));
    }
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} method="post" noValidate>
      <FieldGroup>
        <Area
          control={form.control}
          name="description"
          label={t("descriptionField")}
          placeholder={t("descriptionPlaceholder")}
          rows={3}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Text
            control={form.control}
            name="phone"
            label={t("phone")}
            placeholder={t("phonePlaceholder")}
            type="tel"
            autoComplete="tel"
          />
          <Text control={form.control} name="whatsapp" label={t("whatsapp")} placeholder={t("whatsappPlaceholder")} type="tel" />
        </div>
        <Controller
          name="phoneCountry"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor="phoneCountry">{t("phoneCountry")}</FieldLabel>
              <CountrySelect
                id="phoneCountry"
                value={field.value}
                onValueChange={field.onChange}
                options={countries}
                placeholder={t("phoneCountryNone")}
                noneLabel={t("phoneCountryNone")}
                invalid={fieldState.invalid}
              />
              <FieldDescription>{t("phoneCountryHelp")}</FieldDescription>
              <FieldError errors={[fieldState.error]} />
            </Field>
          )}
        />
        <Controller
          name="timeZone"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor="timeZone">{t("timeZone")}</FieldLabel>
              <div className="flex flex-col gap-2 sm:flex-row">
                <div className="min-w-0 flex-1">
                  <TimeZoneSelect
                    id="timeZone"
                    value={field.value}
                    onValueChange={field.onChange}
                    options={timeZones}
                    placeholder={t("timeZonePlaceholder")}
                    emptyText={t("timeZoneEmpty")}
                    invalid={fieldState.invalid}
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  disabled={!hydrated}
                  onClick={() => {
                    const zone = canonicalTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
                    if (zone) form.setValue("timeZone", zone, { shouldDirty: true, shouldValidate: true });
                  }}
                >
                  {t("timeZoneBrowser")}
                </Button>
              </div>
              <FieldDescription>{t("timeZoneHelp")}</FieldDescription>
              <FieldError errors={[fieldState.error]} />
            </Field>
          )}
        />
        <Text
          control={form.control}
          name="contactEmail"
          label={t("contactEmail")}
          placeholder={t("contactEmailPlaceholder")}
          type="email"
          autoComplete="email"
        />
        <Area control={form.control} name="address" label={t("address")} placeholder={t("addressPlaceholder")} rows={2} />
        <Text
          control={form.control}
          name="metaTitle"
          label={t("metaTitle")}
          help={t("metaHelp")}
          placeholder={t("metaTitlePlaceholder")}
        />
        <Area
          control={form.control}
          name="metaDescription"
          label={t("metaDescription")}
          placeholder={t("metaDescriptionPlaceholder")}
          rows={2}
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

type FieldProps = {
  control: Control<StoreProfileValues>;
  name: keyof StoreProfileValues;
  label: string;
  help?: string;
};

function Text({ control, name, label, help, ...inputProps }: FieldProps & Omit<React.ComponentProps<typeof Input>, "name">) {
  return (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid}>
          <FieldLabel htmlFor={name}>{label}</FieldLabel>
          <Input {...inputProps} {...field} id={name} aria-invalid={fieldState.invalid} />
          {help && <FieldDescription>{help}</FieldDescription>}
          <FieldError errors={[fieldState.error]} />
        </Field>
      )}
    />
  );
}

function Area({ control, name, label, help, placeholder, rows }: FieldProps & { placeholder: string; rows: number }) {
  return (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid}>
          <FieldLabel htmlFor={name}>{label}</FieldLabel>
          <Textarea {...field} id={name} rows={rows} placeholder={placeholder} aria-invalid={fieldState.invalid} />
          {help && <FieldDescription>{help}</FieldDescription>}
          <FieldError errors={[fieldState.error]} />
        </Field>
      )}
    />
  );
}
