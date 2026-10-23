"use client";

import { useStoreId } from "@/components/panel-scope";
import { usePlanErrorMessage } from "@/components/plans/plan-messages";
import { PlanBadge } from "@/components/plans/plan-badge";
import { useHasFeature } from "@/components/plans/plan-provider";
import { useMemo, useState } from "react";
import { Controller, useForm, useWatch, type Control } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { useRouter } from "@/i18n/navigation";
import { DELIVERY_FEE_MODES, type DeliveryFeeMode } from "@/lib/delivery";
import { minorToInput } from "@/lib/money";
import { useHydrated } from "@/lib/use-hydrated";
import { createDeliveryChargesSchema, type DeliveryChargesValues } from "@/lib/validation/delivery-charges";
import type { FormCurrency } from "@/lib/validation/product";
import { saveDeliveryChargesAction } from "@/server/catalog-actions";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

type AmountField = "baseFee" | "perKm" | "freeAbove" | "minOrder";

/** Example amounts (in major units) shown as placeholders */
const EXAMPLE_AMOUNTS: Record<AmountField, number> = { baseFee: 5, perKm: 1, freeAbove: 50, minOrder: 10 };

/**
 * Settings > Delivery, charges: pickup / delivery on-off, how the fee is computed and the
 * amounts in each store currency.
 */
export function DeliveryChargesForm({
  initialValues,
  currencies,
  hasArea,
}: {
  initialValues: DeliveryChargesValues;
  currencies: FormCurrency[];
  /** the map part has a store location and an area (needed to switch delivery on) */
  hasArea: boolean;
}) {
  const storeId = useStoreId();
  const t = useTranslations("Settings.delivery.charges");
  const tv = useTranslations("Validation");
  const locale = useLocale();
  const router = useRouter();
  const hydrated = useHydrated();
  const planError = usePlanErrorMessage();
  const distanceFees = useHasFeature("distanceFees");
  const [formError, setFormError] = useState<string | null>(null);

  const schema = useMemo(() => createDeliveryChargesSchema(tv, currencies), [tv, currencies]);
  const form = useForm<DeliveryChargesValues>({ resolver: zodResolver(schema), defaultValues: initialValues });
  const mode = useWatch({ control: form.control, name: "mode" });
  const deliveryEnabled = useWatch({ control: form.control, name: "deliveryEnabled" });

  async function onSubmit(values: DeliveryChargesValues) {
    setFormError(null);
    const result = await saveDeliveryChargesAction(storeId, values, locale).catch(() => null);
    if (result?.ok) {
      toast.success(t("saved"));
      form.reset(values);
      router.refresh();
    } else if (result?.error === "invalid") {
      for (const [field, messages] of Object.entries(result.fieldErrors ?? {})) {
        form.setError(field as keyof DeliveryChargesValues, { message: messages[0] });
      }
      setFormError(t("errors.invalid"));
    } else if (result?.error === "planLimit" || result?.error === "planFeature") {
      setFormError(planError(result));
    } else {
      const key = result?.error === "forbidden" || result?.error === "deliveryNeedsArea" ? result.error : "failed";
      setFormError(t(`errors.${key}`));
    }
  }

  const amountFields: AmountField[] =
    mode === "free" ? ["minOrder"] : mode === "flat" ? ["baseFee", "freeAbove", "minOrder"] : ["baseFee", "perKm", "freeAbove", "minOrder"];

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} method="post" noValidate className="flex flex-col gap-6">
      <FieldGroup>
        <Toggle control={form.control} name="pickupEnabled" label={t("pickup")} help={t("pickupHelp")} />
        <Toggle
          control={form.control}
          name="deliveryEnabled"
          label={t("delivery")}
          help={hasArea ? t("deliveryHelp") : t("deliveryNeedsArea")}
          disabled={!hasArea && !deliveryEnabled}
        />
      </FieldGroup>

      <FieldGroup>
        <Controller
          name="mode"
          control={form.control}
          render={({ field }) => (
            <Field>
              <FieldLabel htmlFor="delivery-mode">{t("mode")}</FieldLabel>
              <Select value={field.value} onValueChange={(value) => value && field.onChange(value)}>
                <SelectTrigger id="delivery-mode" className="w-full sm:w-72">
                  <SelectValue>{(value: DeliveryFeeMode) => t(`modes.${value}`)}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {DELIVERY_FEE_MODES.map((option) => (
                    // fees by distance are a plan feature (the server refuses saving it without)
                    <SelectItem key={option} value={option} disabled={option === "distance" && !distanceFees}>
                      {t(`modes.${option}`)}
                      {option === "distance" && <PlanBadge feature="distanceFees" className="ml-auto" />}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldDescription>{t(`modeHelp.${mode}`)}</FieldDescription>
            </Field>
          )}
        />
        {mode === "distance" && (
          <Controller
            name="baseDistanceKm"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid} className="sm:max-w-72">
                <FieldLabel htmlFor="delivery-base-distance">{t("baseDistance")}</FieldLabel>
                <Input
                  {...field}
                  id="delivery-base-distance"
                  inputMode="decimal"
                  placeholder={t("baseDistancePlaceholder")}
                  aria-invalid={fieldState.invalid}
                />
                <FieldDescription>{t("baseDistanceHelp")}</FieldDescription>
                <FieldError errors={[fieldState.error]} />
              </Field>
            )}
          />
        )}
      </FieldGroup>

      {currencies.map((currency, index) => (
        <fieldset key={currency.code} className="flex flex-col gap-4 rounded-lg border p-4">
          <legend className="px-1 text-sm font-medium">
            {currency.isDefault ? t("currencyDefault", { currency: currency.code }) : t("currency", { currency: currency.code })}
          </legend>
          {!currency.isDefault && mode !== "free" && <p className="text-sm text-muted-foreground">{t("otherCurrencyHelp")}</p>}
          <div className="grid gap-4 sm:grid-cols-2">
            {amountFields.map((name) => (
              <Controller
                key={name}
                name={`rates.${index}.${name}`}
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor={`rate-${currency.code}-${name}`}>
                      {t(`fields.${name === "baseFee" && mode === "flat" ? "flatFee" : name}`)}
                    </FieldLabel>
                    <Input
                      {...field}
                      id={`rate-${currency.code}-${name}`}
                      inputMode="decimal"
                      autoComplete="off"
                      placeholder={t("amountPlaceholder", {
                        example: minorToInput(EXAMPLE_AMOUNTS[name] * 10 ** currency.digits, currency.digits),
                      })}
                      aria-invalid={fieldState.invalid}
                    />
                    <FieldDescription>{t(`fieldHelp.${name === "baseFee" && mode === "flat" ? "flatFee" : name}`)}</FieldDescription>
                    <FieldError errors={[fieldState.error]} />
                  </Field>
                )}
              />
            ))}
          </div>
        </fieldset>
      ))}

      {formError && (
        <p role="alert" className="text-sm text-destructive">
          {formError}
        </p>
      )}
      <div>
        <Button type="submit" disabled={!hydrated || form.formState.isSubmitting || !form.formState.isDirty}>
          {form.formState.isSubmitting ? t("saving") : t("save")}
        </Button>
      </div>
    </form>
  );
}

function Toggle({
  control,
  name,
  label,
  help,
  disabled,
}: {
  control: Control<DeliveryChargesValues>;
  name: "pickupEnabled" | "deliveryEnabled";
  label: string;
  help: string;
  disabled?: boolean;
}) {
  return (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState }) => (
        <Field orientation="horizontal" data-invalid={fieldState.invalid}>
          <Switch
            id={`toggle-${name}`}
            checked={field.value}
            onCheckedChange={(checked) => field.onChange(checked)}
            disabled={disabled}
            aria-invalid={fieldState.invalid}
          />
          <div className="flex flex-col gap-1">
            <FieldLabel htmlFor={`toggle-${name}`}>{label}</FieldLabel>
            <FieldDescription>{help}</FieldDescription>
            <FieldError errors={[fieldState.error]} />
          </div>
        </Field>
      )}
    />
  );
}
