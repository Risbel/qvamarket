"use client";

import { useEffect, useMemo, useState } from "react";
import { Controller, useFieldArray, useForm, type Control } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { isoToLocalInput, localInputToIso } from "@/components/local-date-time";
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
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { TextField } from "../products/price-fields";

const selectClass = cn(
  "h-8 min-w-0 flex-1 rounded-lg border border-input bg-transparent px-2.5 text-base outline-none md:text-sm",
  "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30",
);

type Props = {
  promotionId?: string;
  /** dates as ISO strings (converted to the browser's local time after hydration) */
  initialValues: PromotionFormValues;
  products: PromotableProduct[];
  currencies: FormCurrency[];
};

export function PromotionForm({ promotionId, initialValues, products, currencies }: Props) {
  const t = useTranslations("Promotions.form");
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

  /** Fills every price with the regular price minus `percent` % */
  function applyPercent() {
    const value = Number(percent);
    if (!Number.isFinite(value) || value <= 0 || value >= 100) return;
    form.getValues("items").forEach((item, i) => {
      const regular = variantInfo.get(item.variantId)?.variant.regular ?? {};
      item.prices.forEach((entry, k) => {
        const base = regular[entry.currency];
        const currency = currencies.find((c) => c.code === entry.currency);
        if (base === undefined || !currency) return;
        form.setValue(`items.${i}.prices.${k}.price`, minorToInput(percentOff(base, value), currency.digits), { shouldDirty: true });
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
          const base = variantInfo.get(item.variantId)?.variant.regular[entry.currency];
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
      ? await updatePromotionAction(promotionId, payload, locale)
      : await createPromotionAction(payload, locale);
    if (result.ok) {
      router.push("/dashboard/promotions");
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
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 text-sm font-medium">{t("kind")}</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {PROMOTION_KINDS.map((value) => (
                  <label
                    key={value}
                    className={cn(
                      "flex cursor-pointer gap-2 rounded-lg border p-3 text-sm",
                      field.value === value && "border-foreground",
                    )}
                  >
                    <input
                      type="radio"
                      name={field.name}
                      value={value}
                      checked={field.value === value}
                      onChange={() => field.onChange(value)}
                      className="mt-1"
                    />
                    <span>
                      <span className="font-medium">{t(`kinds.${value}`)}</span>
                      <span className="block text-muted-foreground">{t(`kindHelp.${value}`)}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <TextField control={form.control} name="startsAt" label={t("startsAt")} description={t("startsAtHelp")} type="datetime-local" />
          <TextField control={form.control} name="endsAt" label={t("endsAt")} description={t("endsAtHelp")} type="datetime-local" />
        </div>
        {timeZone && <p className="-mt-3 text-xs text-muted-foreground">{t("timeZone", { zone: timeZone })}</p>}

        <Controller
          name="status"
          control={form.control}
          render={({ field }) => (
            <Field orientation="horizontal">
              <input
                id="promotion-active"
                type="checkbox"
                checked={field.value === "active"}
                onChange={(event) => field.onChange(event.target.checked ? "active" : "draft")}
                className="size-4"
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
            <select id="add-product" value={adding} onChange={(e) => setAdding(e.target.value)} className={selectClass}>
              <option value="">{available.length ? t("chooseProduct") : t("noMoreProducts")}</option>
              {available.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.status === "draft" ? t("draftProduct", { name: p.name }) : p.name}
                </option>
              ))}
            </select>
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

/** Promotion price inputs of one variant: one per currency it has a regular price in. */
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
  regular: Record<string, number>;
  currencies: FormCurrency[];
  locale: string;
}) {
  const t = useTranslations("Promotions.form");
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
                const base = regular[currency.code];
                const price = field.value ? parsePriceToMinor(field.value, currency.digits) : null;
                const off = price !== null && price < base ? Math.round(((base - price) / base) * 100) : null;
                return (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor={field.name}>{t("promoPrice", { currency: currency.code })}</FieldLabel>
                    <Input {...field} id={field.name} inputMode="decimal" autoComplete="off" aria-invalid={fieldState.invalid} />
                    <FieldDescription>
                      {t("regularPrice", { price: formatMoney(base, currency.code, locale) })}
                      {off !== null && off > 0 && <span className="font-medium text-foreground"> · −{off} %</span>}
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
