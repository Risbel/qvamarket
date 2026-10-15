"use client";

import {
  Controller,
  useFieldArray,
  type ArrayPath,
  type Control,
  type FieldArray,
  type FieldValues,
  type Path,
} from "react-hook-form";
import { useTranslations } from "next-intl";
import { minorToInput } from "@/lib/money";
import { MAX_TIERS, type FormCurrency } from "@/lib/validation/product";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

// Fields shared by the product form (simple products) and the variants form.

export function TextField<T extends FieldValues>({
  control,
  name,
  label,
  description,
  ...inputProps
}: {
  control: Control<T>;
  name: Path<T>;
  label: string;
  description?: string;
} & Omit<React.ComponentProps<typeof Input>, "name">) {
  return (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid}>
          <FieldLabel htmlFor={name}>{label}</FieldLabel>
          <Input
            {...inputProps}
            {...field}
            value={(field.value as string | undefined) ?? ""}
            id={name}
            aria-invalid={fieldState.invalid}
          />
          {description && <FieldDescription>{description}</FieldDescription>}
          <FieldError errors={[fieldState.error]} />
        </Field>
      )}
    />
  );
}

/**
 * Regular price, compare-at price and volume tiers in one currency. `base` is the path of the
 * prices entry in the form, e.g. "prices.0" or "variants.3.prices.1".
 */
export function CurrencyPrices<T extends FieldValues>({
  control,
  base,
  currency,
}: {
  control: Control<T>;
  base: string;
  currency: FormCurrency;
}) {
  const t = useTranslations("Products.form");
  const tiers = useFieldArray({ control, name: `${base}.tiers` as ArrayPath<T> });
  const path = (rest: string) => `${base}.${rest}` as Path<T>;
  // An example amount written with the currency's decimals ("25.00", or "25" for a currency without decimals)
  const example = (major: number) => t("amountPlaceholder", { example: minorToInput(major * 10 ** currency.digits, currency.digits) });

  return (
    <fieldset className="flex flex-col gap-3 rounded-lg border p-4" data-currency={currency.code}>
      <legend className="px-1 text-sm font-medium">
        {currency.code} {currency.isDefault && <span className="text-muted-foreground">· {t("defaultCurrency")}</span>}
      </legend>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          control={control}
          name={path("price")}
          label={t("price", { currency: currency.code })}
          description={currency.isDefault ? undefined : t("priceOptional")}
          placeholder={example(25)}
          inputMode="decimal"
          autoComplete="off"
        />
        <TextField
          control={control}
          name={path("compareAt")}
          label={t("compareAt", { currency: currency.code })}
          description={t("compareAtHelp")}
          placeholder={example(30)}
          inputMode="decimal"
          autoComplete="off"
        />
      </div>

      {tiers.fields.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">{t("tiersTitle")}</span>
          {tiers.fields.map((tier, k) => (
            <div key={tier.id} className="grid grid-cols-[1fr_1fr_auto] items-start gap-2">
              <TextField
                control={control}
                name={path(`tiers.${k}.minQuantity`)}
                label={t("tierFrom")}
                placeholder={t("tierFromPlaceholder")}
                inputMode="numeric"
                autoComplete="off"
              />
              <TextField
                control={control}
                name={path(`tiers.${k}.price`)}
                label={t("tierPrice", { currency: currency.code })}
                placeholder={example(22)}
                inputMode="decimal"
                autoComplete="off"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-6"
                onClick={() => tiers.remove(k)}
                aria-label={t("tierRemove")}
              >
                ×
              </Button>
            </div>
          ))}
        </div>
      )}
      {tiers.fields.length < MAX_TIERS && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-fit"
          onClick={() => tiers.append({ minQuantity: "", price: "" } as FieldArray<T, ArrayPath<T>>)}
        >
          {t("tierAdd")}
        </Button>
      )}
    </fieldset>
  );
}
