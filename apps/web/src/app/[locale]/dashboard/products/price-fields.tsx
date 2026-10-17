"use client";

import { useState } from "react";
import {
  Controller,
  get,
  useController,
  useFieldArray,
  useFormState,
  useWatch,
  type ArrayPath,
  type Control,
  type FieldArray,
  type FieldValues,
  type Path,
  type PathValue,
} from "react-hook-form";
import { useLocale, useTranslations } from "next-intl";
import { ChevronDownIcon } from "lucide-react";
import { convertMinor } from "@/lib/exchange";
import { formatMoney, minorToInput, parsePriceToMinor } from "@/lib/money";
import { MAX_TIERS, type FormCurrency } from "@/lib/validation/product";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

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
        {currency.code} {currency.isBase && <span className="text-muted-foreground">· {t("baseCurrency")}</span>}
      </legend>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          control={control}
          name={path("price")}
          label={t("price", { currency: currency.code })}
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

/**
 * Every price of a variant: the base currency's card, then the other currencies in a section
 * that starts closed (most products just follow the rates). Each other currency follows the
 * rate (shown as "≈ amount") or, with its switch on, has its own prices. `base` is the path of
 * the prices array, e.g. "prices" or "variants.3.prices".
 */
export function VariantPrices<T extends FieldValues>({
  control,
  base,
  currencies,
}: {
  control: Control<T>;
  base: string;
  currencies: FormCurrency[];
}) {
  const t = useTranslations("Products.form");
  const { errors, defaultValues } = useFormState({ control, name: base as Path<T> });
  const baseIndex = Math.max(
    currencies.findIndex((c) => c.isBase),
    0,
  );
  const others = currencies.flatMap((currency, index) => (index === baseIndex ? [] : [{ currency, index }]));
  // Open from the start when some currency has its own prices (the merchant should see them)
  const [open, setOpen] = useState(() => others.some(({ index }) => get(defaultValues, `${base}.${index}.manual`) === true));
  const hasErrors = others.some(({ index }) => get(errors, `${base}.${index}`) !== undefined);
  const expanded = open || hasErrors;
  const regionId = `${base}-other-currencies`.replaceAll(".", "-");

  return (
    <div className="flex flex-col gap-3">
      <CurrencyPrices control={control} base={`${base}.${baseIndex}`} currency={currencies[baseIndex]} />
      {others.length > 0 && (
        <div className="rounded-lg border">
          <button
            type="button"
            className="flex w-full items-center justify-between gap-3 p-3 text-left text-sm font-medium"
            aria-expanded={expanded}
            aria-controls={regionId}
            onClick={() => setOpen(!expanded)}
          >
            {t("otherCurrencies", { count: others.length })}
            <ChevronDownIcon aria-hidden className={expanded ? "size-4 rotate-180 transition-transform" : "size-4 transition-transform"} />
          </button>
          {/* Hidden, not unmounted, so the fields keep validating */}
          <div id={regionId} hidden={!expanded} className="flex flex-col divide-y border-t">
            {others.map(({ currency, index }) => (
              <OtherCurrencyPrices
                key={currency.code}
                control={control}
                base={base}
                index={index}
                currency={currency}
                baseCurrency={currencies[baseIndex]}
                baseIndex={baseIndex}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** One currency other than the base: following the rate (≈ amount) or with its own prices. */
function OtherCurrencyPrices<T extends FieldValues>({
  control,
  base,
  index,
  currency,
  baseCurrency,
  baseIndex,
}: {
  control: Control<T>;
  base: string;
  index: number;
  currency: FormCurrency;
  baseCurrency: FormCurrency;
  baseIndex: number;
}) {
  const t = useTranslations("Products.form");
  const locale = useLocale();
  const entry = `${base}.${index}`;
  const { field: manualField } = useController({ control, name: `${entry}.manual` as Path<T> });
  const { field: priceField } = useController({ control, name: `${entry}.price` as Path<T> });
  const basePrice = useWatch({ control, name: `${base}.${baseIndex}.price` as Path<T> }) as string | undefined;
  const { defaultValues } = useFormState({ control, name: `${entry}.manual` as Path<T> });

  const manual = manualField.value === true;
  const baseMinor = basePrice ? parsePriceToMinor(basePrice, baseCurrency.digits) : null;
  const autoMinor = baseMinor === null ? null : convertMinor(baseMinor, baseCurrency, currency);
  // The saved manual price, to show what it becomes when the switch goes back to the rate
  const savedPrice =
    get(defaultValues, `${entry}.manual`) === true
      ? parsePriceToMinor(String(get(defaultValues, `${entry}.price`) ?? ""), currency.digits)
      : null;
  const money = (minor: number) => formatMoney(minor, currency.code, locale);
  const switchId = `${entry}.manual`;

  let summary: string;
  if (currency.rate === null) summary = t("autoNoRate", { currency: currency.code });
  else if (autoMinor === null) summary = t("autoNeedsBase", { base: baseCurrency.code });
  else summary = t("autoValue", { price: money(autoMinor) });

  return (
    <div className="flex flex-col gap-3 p-3" data-currency={currency.code}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-col">
          <span className="text-sm font-medium">{currency.code}</span>
          {!manual && (
            <>
              <span className="text-sm text-muted-foreground" data-testid="auto-price">
                {summary}
              </span>
              {currency.rate !== null && (
                <span className="text-xs text-muted-foreground">
                  {t("autoRate", { base: baseCurrency.code, rate: currency.rate, currency: currency.code })}
                  {currency.roundingMinor !== null &&
                    currency.roundingMinor > 1 &&
                    ` · ${t("autoRounding", { step: money(currency.roundingMinor) })}`}
                </span>
              )}
              {savedPrice !== null && autoMinor !== null && savedPrice !== autoMinor && (
                <span className="text-xs font-medium" role="status">
                  {t("autoChange", { from: money(savedPrice), to: money(autoMinor) })}
                </span>
              )}
            </>
          )}
        </div>
        <label htmlFor={switchId} className="flex items-center gap-2 text-sm">
          <Switch
            id={switchId}
            checked={manual}
            onCheckedChange={(checked) => {
              manualField.onChange(checked);
              // Manual starts from the automatic price, so the merchant only adjusts it
              if (checked && !priceField.value && autoMinor !== null) {
                priceField.onChange(minorToInput(autoMinor, currency.digits) as PathValue<T, Path<T>>);
              }
            }}
          />
          {t("manualPrice")}
        </label>
      </div>
      {manual && <CurrencyPrices control={control} base={entry} currency={currency} />}
    </div>
  );
}
