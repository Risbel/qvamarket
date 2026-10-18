"use client";

import { useStoreId, useStorePath } from "@/components/panel-scope";
import { useEffect, useMemo, useState } from "react";
import { Controller, useFieldArray, useForm, useWatch, type Control } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { useRouter } from "@/i18n/navigation";
import { DateTimePicker } from "@/components/date-time-picker";
import { isoToLocalInput, localInputToIso } from "@/components/local-date-time";
import { convertMinor } from "@/lib/exchange";
import { formatMoney, minorToInput, parsePriceToMinor } from "@/lib/money";
import { percentOff } from "@/lib/promotions";
import { useHydrated } from "@/lib/use-hydrated";
import type { FormCurrency } from "@/lib/validation/product";
import {
  createPromotionSchema,
  MAX_PROMOTION_VARIANTS,
  PROMOTION_KINDS,
  type PromotionFormValues,
} from "@/lib/validation/promotion";
import { createPromotionAction, updatePromotionAction } from "@/server/promotion-actions";
import type { PromotableProduct } from "@/server/promotions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TextField } from "../products/price-fields";

type Props = {
  promotionId?: string;
  /** dates as ISO strings (converted to the browser's local time after hydration) */
  initialValues: PromotionFormValues;
  products: PromotableProduct[];
  currencies: FormCurrency[];
};

export function PromotionForm({ promotionId, initialValues, products, currencies }: Props) {
  const storeId = useStoreId();
  const t = useTranslations("Promotions.form");
  const panelPath = useStorePath();
  const tv = useTranslations("Validation");
  const locale = useLocale();
  const router = useRouter();
  const hydrated = useHydrated();
  const [formError, setFormError] = useState<string | null>(null);
  const [adding, setAdding] = useState("");
  const [percent, setPercent] = useState("");

  const schema = useMemo(() => createPromotionSchema(tv, currencies), [tv, currencies]);
  const blank = { ...initialValues, startsAt: "", endsAt: "" };
  const form = useForm<PromotionFormValues>({ resolver: zodResolver(schema), defaultValues: blank });
  const items = useFieldArray({ control: form.control, name: "items" });

  // Dates are shown in the merchant's timezone, which only the browser knows
  useEffect(() => {
    form.reset({
      ...form.getValues(),
      startsAt: isoToLocalInput(initialValues.startsAt || null),
      endsAt: isoToLocalInput(initialValues.endsAt || null),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, after hydration
  }, []);

  const variantInfo = useMemo(() => {
    const map = new Map<string, { product: PromotableProduct; variant: PromotableProduct["variants"][number] }>();
    for (const product of products) for (const variant of product.variants) map.set(variant.id, { product, variant });
    return map;
  }, [products]);
  const kind = form.watch("kind");
  const timeZone = hydrated ? Intl.DateTimeFormat().resolvedOptions().timeZone : "";

  // Products in the promotion, in the order they were added, with their rows in the form
  const groups: { product: PromotableProduct; rows: { index: number; variant: PromotableProduct["variants"][number] }[] }[] = [];
  items.fields.forEach((field, index) => {
    const info = variantInfo.get(field.variantId);
    if (!info) return;
    let group = groups.find((g) => g.product.id === info.product.id);
    if (!group) groups.push((group = { product: info.product, rows: [] }));
    group.rows.push({ index, variant: info.variant });
  });
  const added = new Set(groups.map((g) => g.product.id));
  const productLabel = (p: PromotableProduct) => (p.status === "draft" ? t("draftProduct", { name: p.name }) : p.name);
  const available = products.filter((p) => !added.has(p.id) && p.status !== "archived" && p.variants.some((v) => Object.keys(v.regular).length > 0));
  const rowCount = items.fields.length;

  function addProduct(productId: string) {
    const product = products.find((p) => p.id === productId);
    if (!product) return;
    items.append(
      product.variants.map((variant) => ({
        variantId: variant.id,
        prices: currencies.map((c) => ({ currency: c.code, price: "" })),
      })),
    );
    setAdding("");
  }

  function removeProduct(productId: string) {
    const indexes = items.fields.flatMap((field, i) => (variantInfo.get(field.variantId)?.product.id === productId ? [i] : []));
    items.remove(indexes);
  }

  /**
   * Fills the prices with the regular price minus `percent` %: in the base currency and where
   * the regular price is manual. Currencies following the rate stay empty, so they follow it.
   */
  function applyPercent() {
    const value = Number(percent);
    if (!Number.isFinite(value) || value <= 0 || value >= 100) return;
    form.getValues("items").forEach((item, i) => {
      const regular = variantInfo.get(item.variantId)?.variant.regular ?? {};
      item.prices.forEach((entry, k) => {
        const base = regular[entry.currency];
        const currency = currencies.find((c) => c.code === entry.currency);
        if (base === undefined || !currency || (base.auto && !currency.isBase)) return;
        form.setValue(`items.${i}.prices.${k}.price`, minorToInput(percentOff(base.amountMinor, value), currency.digits), { shouldDirty: true });
      });
    });
  }

  /** A sale price must be below the regular price, or it never applies */
  function markNotCheaper(rows: { variantId: string; currencyCode: string }[]) {
    const values = form.getValues("items");
    for (const row of rows) {
      const i = values.findIndex((item) => item.variantId === row.variantId);
      const k = values[i]?.prices.findIndex((entry) => entry.currency === row.currencyCode) ?? -1;
      if (i >= 0 && k >= 0) form.setError(`items.${i}.prices.${k}.price`, { message: tv("promotionNotCheaper") });
    }
  }

  async function onSubmit(values: PromotionFormValues) {
    setFormError(null);
    if (values.kind === "sale") {
      const offending = values.items.flatMap((item) =>
        item.prices.flatMap((entry) => {
          const base = variantInfo.get(item.variantId)?.variant.regular[entry.currency]?.amountMinor;
          const digits = currencies.find((c) => c.code === entry.currency)?.digits ?? 2;
          const price = entry.price === "" ? null : parsePriceToMinor(entry.price, digits);
          return price !== null && base !== undefined && price >= base ? [{ variantId: item.variantId, currencyCode: entry.currency }] : [];
        }),
      );
      if (offending.length) {
        markNotCheaper(offending);
        return;
      }
    }
    const payload = { ...values, startsAt: localInputToIso(values.startsAt), endsAt: localInputToIso(values.endsAt) };
    const result = promotionId
      ? await updatePromotionAction(storeId, promotionId, payload, locale)
      : await createPromotionAction(storeId, payload, locale);
    if (result.ok) {
      toast.success(t(promotionId ? "toasts.saved" : "toasts.created", { name: values.name.trim() }));
      router.push(panelPath("/promotions"));
      router.refresh();
      return;
    }
    if (result.error === "notCheaper") markNotCheaper(result.rows ?? []);
    else if (result.error === "invalid") {
      for (const [field, messages] of Object.entries(result.fieldErrors ?? {})) {
        if (field === "name" || field === "startsAt" || field === "endsAt") form.setError(field, { message: messages[0] });
        else setFormError(messages[0]);
      }
    } else {
      setFormError(t(`errors.${result.error === "forbidden" || result.error === "stale" || result.error === "notFound" ? result.error : "failed"}`));
      if (result.error === "stale") router.refresh();
    }
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} method="post" noValidate>
      <FieldGroup>
        <TextField control={form.control} name="name" label={t("name")} placeholder={t("namePlaceholder")} autoComplete="off" />

        <Controller
          name="kind"
          control={form.control}
          render={({ field }) => (
            <FieldSet>
              <FieldLegend variant="label">{t("kind")}</FieldLegend>
              <RadioGroup value={field.value} onValueChange={field.onChange} className="grid gap-2 sm:grid-cols-2">
                {PROMOTION_KINDS.map((value) => (
                  <FieldLabel key={value} htmlFor={`promotion-kind-${value}`}>
                    <Field orientation="horizontal">
                      <RadioGroupItem value={value} id={`promotion-kind-${value}`} />
                      <FieldContent>
                        <FieldTitle>{t(`kinds.${value}`)}</FieldTitle>
                        <FieldDescription>{t(`kindHelp.${value}`)}</FieldDescription>
                      </FieldContent>
                    </Field>
                  </FieldLabel>
                ))}
              </RadioGroup>
            </FieldSet>
          )}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <DateField control={form.control} name="startsAt" defaultTime="00:00" locale={locale} />
          <DateField control={form.control} name="endsAt" defaultTime="23:59" locale={locale} />
        </div>
        {timeZone && <p className="-mt-3 text-xs text-muted-foreground">{t("timeZone", { zone: timeZone })}</p>}

        <Controller
          name="status"
          control={form.control}
          render={({ field }) => (
            <Field orientation="horizontal">
              <Checkbox
                id="promotion-active"
                checked={field.value === "active"}
                onCheckedChange={(checked) => field.onChange(checked ? "active" : "draft")}
              />
              <FieldLabel htmlFor="promotion-active" className="font-normal">
                {t("active")}
              </FieldLabel>
            </Field>
          )}
        />

        {/* ---- products and prices */}
        <section className="flex flex-col gap-4" aria-labelledby="promotion-products-title">
          <div>
            <h2 id="promotion-products-title" className="text-base font-semibold">
              {t("productsTitle")}
            </h2>
            <p className="text-sm text-muted-foreground">{kind === "sale" ? t("productsHelpSale") : t("productsHelpOverride")}</p>
          </div>

          <div className="flex gap-2">
            <label className="sr-only" htmlFor="add-product">
              {t("addProduct")}
            </label>
            <Select
              value={adding || null}
              onValueChange={(value) => setAdding(typeof value === "string" ? value : "")}
              disabled={available.length === 0}
            >
              <SelectTrigger id="add-product" className="min-w-0 flex-1">
                <SelectValue>
                  {(id: string | null) => {
                    const product = id ? products.find((p) => p.id === id) : undefined;
                    if (product) return productLabel(product);
                    return available.length ? t("chooseProduct") : t("noMoreProducts");
                  }}
                </SelectValue>
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false} align="start">
                {available.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {productLabel(p)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="outline"
              disabled={!hydrated || adding === "" || rowCount >= MAX_PROMOTION_VARIANTS}
              onClick={() => addProduct(adding)}
            >
              {t("addProduct")}
            </Button>
          </div>

          {groups.length > 0 && (
            <div className="flex flex-wrap items-end gap-2 rounded-lg bg-muted/50 p-3">
              <Field className="w-32">
                <FieldLabel htmlFor="percent-off">{t("percentOff")}</FieldLabel>
                <Input
                  id="percent-off"
                  inputMode="numeric"
                  placeholder={t("percentOffPlaceholder")}
                  value={percent}
                  onChange={(e) => setPercent(e.target.value.replace(/[^\d]/g, "").slice(0, 2))}
                />
              </Field>
              <Button type="button" variant="outline" disabled={!percent || Number(percent) <= 0} onClick={applyPercent}>
                {t("applyPercent")}
              </Button>
            </div>
          )}

          {groups.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noProducts")}</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {groups.map((group) => (
                <li key={group.product.id} className="rounded-lg border p-3" data-product={group.product.name}>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="font-medium">{group.product.name}</span>
                    <Button type="button" variant="ghost" size="sm" onClick={() => removeProduct(group.product.id)}>
                      {t("removeProduct")}
                    </Button>
                  </div>
                  <div className="flex flex-col gap-3">
                    {group.rows.map(({ index, variant }) => (
                      <VariantPrices
                        key={variant.id}
                        control={form.control}
                        index={index}
                        title={variant.title}
                        regular={variant.regular}
                        currencies={currencies}
                        locale={locale}
                      />
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {formError && <FieldError>{formError}</FieldError>}
        <div>
          <Button type="submit" disabled={!hydrated || form.formState.isSubmitting}>
            {form.formState.isSubmitting ? t("saving") : t("save")}
          </Button>
        </div>
      </FieldGroup>
    </form>
  );
}

/** Start or end of the promotion: a day and a time in the merchant's timezone, or empty. */
function DateField({
  control,
  name,
  defaultTime,
  locale,
}: {
  control: Control<PromotionFormValues>;
  name: "startsAt" | "endsAt";
  /** time set when a day is picked first */
  defaultTime: string;
  locale: string;
}) {
  const t = useTranslations("Promotions.form");
  return (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid}>
          <FieldLabel htmlFor={name}>{t(name)}</FieldLabel>
          <DateTimePicker
            id={name}
            value={field.value}
            onChange={field.onChange}
            defaultTime={defaultTime}
            locale={locale}
            invalid={fieldState.invalid}
            labels={{ placeholder: t("datePlaceholder"), time: t(`${name}Time`), clear: t(`${name}Clear`) }}
          />
          <FieldDescription>{t(`${name}Help`)}</FieldDescription>
          <FieldError errors={[fieldState.error]} />
        </Field>
      )}
    />
  );
}

/**
 * Promotion price inputs of one variant: one per currency it is sold in. Outside the base
 * currency an empty price follows the base promotion price through the rate.
 */
function VariantPrices({
  control,
  index,
  title,
  regular,
  currencies,
  locale,
}: {
  control: Control<PromotionFormValues>;
  index: number;
  title: string | null;
  regular: PromotableProduct["variants"][number]["regular"];
  currencies: FormCurrency[];
  locale: string;
}) {
  const t = useTranslations("Promotions.form");
  const baseIndex = Math.max(
    currencies.findIndex((c) => c.isBase),
    0,
  );
  const baseCurrency = currencies[baseIndex];
  const basePromo = useWatch({ control, name: `items.${index}.prices.${baseIndex}.price` });
  const basePromoMinor = basePromo ? parsePriceToMinor(basePromo, baseCurrency.digits) : null;
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-4" data-variant={title ?? ""}>
      {title && <span className="text-sm sm:w-28 sm:pt-1.5">{title}</span>}
      <div className="grid flex-1 gap-3 sm:grid-cols-2">
        {currencies.map((currency, k) =>
          regular[currency.code] === undefined ? null : (
            <Controller
              key={currency.code}
              control={control}
              name={`items.${index}.prices.${k}.price`}
              render={({ field, fieldState }) => {
                const base = regular[currency.code].amountMinor;
                // Empty outside the base: the base promotion price converted at the rate
                const auto =
                  !currency.isBase && !field.value && basePromoMinor !== null
                    ? convertMinor(basePromoMinor, baseCurrency, currency)
                    : null;
                const price = field.value ? parsePriceToMinor(field.value, currency.digits) : auto;
                const off = price !== null && price < base ? Math.round(((base - price) / base) * 100) : null;
                return (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor={field.name}>{t("promoPrice", { currency: currency.code })}</FieldLabel>
                    <Input
                      {...field}
                      id={field.name}
                      inputMode="decimal"
                      autoComplete="off"
                      placeholder={t("promoPricePlaceholder", { example: minorToInput(percentOff(base, 10), currency.digits) })}
                      aria-invalid={fieldState.invalid}
                    />
                    <FieldDescription>
                      {t("regularPrice", { price: formatMoney(base, currency.code, locale) })}
                      {off !== null && off > 0 && <span className="font-medium text-foreground"> · −{off} %</span>}
                      {!currency.isBase && currency.rate !== null && (
                        <span className="block">
                          {auto !== null
                            ? t("followsRate", { price: formatMoney(auto, currency.code, locale) })
                            : !field.value && t("emptyFollowsRate", { base: baseCurrency.code })}
                        </span>
                      )}
                    </FieldDescription>
                    <FieldError errors={[fieldState.error]} />
                  </Field>
                );
              }}
            />
          ),
        )}
      </div>
    </div>
  );
}
