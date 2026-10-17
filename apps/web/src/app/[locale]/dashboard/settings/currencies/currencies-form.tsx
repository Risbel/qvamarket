"use client";

import { useMemo, useState } from "react";
import { Controller, useFieldArray, useForm, useWatch, type Control } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { useRouter } from "@/i18n/navigation";
import { rebaseRates, roundingSteps } from "@/lib/exchange";
import { formatMoney } from "@/lib/money";
import { useHydrated } from "@/lib/use-hydrated";
import {
  createCurrenciesSchema,
  MAX_STORE_CURRENCIES,
  type CurrenciesValues,
} from "@/lib/validation/catalog-settings";
import { setStoreCurrenciesAction } from "@/server/catalog-actions";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Available = { code: string; label: string; digits: number };

/** Select value for "no rounding" (a Select item cannot have a null value). */
const NO_ROUNDING = "none";

/**
 * Currencies the store sells in. Prices are typed in the base currency; every other currency
 * has a rate ("1 USD = 800 CUP") and products follow it unless they have their own (manual)
 * price there. Changing a rate changes every automatic price at once. A currency that still
 * has manual prices cannot be removed.
 */
export function CurrenciesForm({
  initialValues,
  available,
}: {
  initialValues: CurrenciesValues;
  available: Available[];
}) {
  const t = useTranslations("Settings.currencies");
  const tv = useTranslations("Validation");
  const locale = useLocale();
  const router = useRouter();
  const hydrated = useHydrated();
  const [adding, setAdding] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const schema = useMemo(() => createCurrenciesSchema(tv), [tv]);
  const form = useForm<CurrenciesValues>({ resolver: zodResolver(schema), defaultValues: initialValues });
  const list = useFieldArray({ control: form.control, name: "currencies" });
  const currencies = useWatch({ control: form.control, name: "currencies" });
  const baseCode = useWatch({ control: form.control, name: "baseCode" });
  const defaultCode = useWatch({ control: form.control, name: "defaultCode" });
  const byCode = new Map(available.map((c) => [c.code, c]));
  const labelOf = (code: string) => byCode.get(code)?.label ?? code;

  /** A new base: the rates are re-expressed per 1 unit of it (the merchant can adjust them). */
  function changeBase(next: string) {
    const current = form.getValues();
    if (next === current.baseCode) return;
    const rates = rebaseRates(
      Object.fromEntries(current.currencies.map((c) => [c.code, c.rate || null])),
      current.baseCode,
      next,
    );
    current.currencies.forEach((c, i) => form.setValue(`currencies.${i}.rate`, rates[c.code] ?? "", { shouldDirty: true }));
    form.setValue("baseCode", next, { shouldDirty: true });
  }

  async function onSubmit(values: CurrenciesValues) {
    setFormError(null);
    const result = await setStoreCurrenciesAction(values, locale);
    if (result.ok) {
      toast.success(t("saved"));
      form.reset(values);
      router.refresh();
      return;
    }
    switch (result.error) {
      case "invalid":
        for (const [field, messages] of Object.entries(result.fieldErrors ?? {})) {
          form.setError(field as `currencies.${number}.rate`, { message: messages[0] });
        }
        if (!result.fieldErrors) setFormError(t("errors.failed"));
        return;
      case "inUse":
        setFormError(t("inUse", { codes: (result.codes ?? []).join(", ") }));
        return;
      case "baseMissingPrices":
        setFormError(t("baseMissingPrices", { count: result.count ?? 0, currency: values.baseCode }));
        return;
      default:
        setFormError(t(`errors.${result.error === "forbidden" ? "forbidden" : "failed"}`));
    }
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} method="post" noValidate className="flex flex-col gap-6">
      <Field>
        <FieldLabel htmlFor="base-currency">{t("base")}</FieldLabel>
        <Select value={baseCode} onValueChange={(value) => typeof value === "string" && changeBase(value)}>
          <SelectTrigger id="base-currency" className="w-full sm:w-80">
            <SelectValue>{(code: string) => labelOf(code)}</SelectValue>
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false} align="start">
            {currencies.map((c) => (
              <SelectItem key={c.code} value={c.code}>
                {labelOf(c.code)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FieldDescription>{t("baseHelp")}</FieldDescription>
      </Field>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">{t("enabled")}</span>
        <Controller
          name="defaultCode"
          control={form.control}
          render={({ field }) => (
            <RadioGroup
              value={field.value}
              onValueChange={(value) => typeof value === "string" && field.onChange(value)}
              aria-label={t("enabled")}
              className="flex flex-col gap-0 divide-y rounded-lg border"
            >
              {list.fields.map((entry, index) => (
                <CurrencyRow
                  key={entry.id}
                  control={form.control}
                  index={index}
                  code={entry.code}
                  label={labelOf(entry.code)}
                  digits={byCode.get(entry.code)?.digits ?? 2}
                  baseCode={baseCode}
                  isDefault={defaultCode === entry.code}
                  locale={locale}
                  canRemove={hydrated && list.fields.length > 1 && entry.code !== baseCode && entry.code !== defaultCode}
                  onRemove={() => list.remove(index)}
                />
              ))}
            </RadioGroup>
          )}
        />
        <p className="text-sm text-muted-foreground">{t("defaultHelp")}</p>
      </div>

      <div className="flex gap-2">
        <label className="sr-only" htmlFor="add-currency">
          {t("add")}
        </label>
        <Select value={adding || null} onValueChange={(value) => setAdding(typeof value === "string" ? value : "")}>
          <SelectTrigger id="add-currency" className="min-w-0 flex-1">
            <SelectValue placeholder={t("choose")}>
              {(code: string | null) => (code ? labelOf(code) : t("choose"))}
            </SelectValue>
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false} align="start">
            {available
              .filter((c) => !currencies.some((enabled) => enabled.code === c.code))
              .map((c) => (
                <SelectItem key={c.code} value={c.code}>
                  {c.label}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant="outline"
          disabled={!hydrated || adding === "" || list.fields.length >= MAX_STORE_CURRENCIES}
          onClick={() => {
            list.append({ code: adding, rate: "", roundingMinor: null });
            setAdding("");
          }}
        >
          {t("add")}
        </Button>
      </div>

      <p className="text-sm text-muted-foreground">{t("help")}</p>
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

/** One enabled currency: default radio, and for all but the base its rate and rounding. */
function CurrencyRow({
  control,
  index,
  code,
  label,
  digits,
  baseCode,
  isDefault,
  locale,
  canRemove,
  onRemove,
}: {
  control: Control<CurrenciesValues>;
  index: number;
  code: string;
  label: string;
  digits: number;
  baseCode: string;
  isDefault: boolean;
  locale: string;
  canRemove: boolean;
  onRemove: () => void;
}) {
  const t = useTranslations("Settings.currencies");
  const isBase = code === baseCode;
  const steps = roundingSteps(digits);

  return (
    <div className="flex flex-col gap-3 p-3" data-currency={code}>
      <div className="flex items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm">
          <RadioGroupItem value={code} aria-label={t("makeDefault", { code })} />
          <span className="font-medium">{label}</span>
          {isDefault && <span className="text-xs text-muted-foreground">· {t("default")}</span>}
          {isBase && <span className="text-xs text-muted-foreground">· {t("baseTag")}</span>}
        </label>
        <Button type="button" size="sm" variant="outline" disabled={!canRemove} onClick={onRemove}>
          {t("remove")}
        </Button>
      </div>

      {!isBase && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Controller
            name={`currencies.${index}.rate`}
            control={control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor={`rate-${code}`}>{t("rate")}</FieldLabel>
                <InputGroup>
                  <InputGroupAddon>
                    <InputGroupText>1 {baseCode} =</InputGroupText>
                  </InputGroupAddon>
                  <InputGroupInput
                    {...field}
                    id={`rate-${code}`}
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder={t("ratePlaceholder")}
                    aria-invalid={fieldState.invalid}
                  />
                  <InputGroupAddon align="inline-end">
                    <InputGroupText>{code}</InputGroupText>
                  </InputGroupAddon>
                </InputGroup>
                <FieldDescription>{t("rateHelp")}</FieldDescription>
                <FieldError errors={[fieldState.error]} />
              </Field>
            )}
          />
          <Controller
            name={`currencies.${index}.roundingMinor`}
            control={control}
            render={({ field }) => (
              <Field>
                <FieldLabel htmlFor={`rounding-${code}`}>{t("rounding")}</FieldLabel>
                <Select
                  value={field.value === null ? NO_ROUNDING : String(field.value)}
                  onValueChange={(value) =>
                    field.onChange(typeof value !== "string" || value === NO_ROUNDING ? null : Number(value))
                  }
                >
                  <SelectTrigger id={`rounding-${code}`} className="w-full">
                    <SelectValue>
                      {(value: string) =>
                        value === NO_ROUNDING ? t("noRounding") : t("roundTo", { step: formatMoney(Number(value), code, locale) })
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_ROUNDING}>{t("noRounding")}</SelectItem>
                    {steps
                      .filter((step) => step > 1)
                      .map((step) => (
                        <SelectItem key={step} value={String(step)}>
                          {t("roundTo", { step: formatMoney(step, code, locale) })}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                <FieldDescription>{t("roundingHelp")}</FieldDescription>
              </Field>
            )}
          />
        </div>
      )}
    </div>
  );
}
