"use client";

import { useStoreId } from "@/components/panel-scope";
import { useEffect, useMemo, useState } from "react";
import { useForm, type FieldErrors } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { useRouter } from "@/i18n/navigation";
import { useHydrated } from "@/lib/use-hydrated";
import { createVariantsSchema, type FormCurrency, type VariantsFormValues } from "@/lib/validation/product";
import { saveVariantsAction } from "@/server/variant-actions";
import { useInheritedDisabled } from "@/components/inherited-disabled";
import { Button } from "@/components/ui/button";
import { pricesToFormValues } from "../../form-values";
import { TextField, VariantPrices } from "../../price-fields";

type Variant = {
  id: string;
  title: string | null;
  sku: string | null;
  stock: number | null;
  prices: { currencyCode: string; minQuantity: number; amountMinor: number; compareAtMinor: number | null }[];
};

const toValues = (variants: Variant[], currencies: FormCurrency[]): VariantsFormValues => ({
  variants: variants.map((v) => ({
    id: v.id,
    sku: v.sku ?? "",
    stock: v.stock == null ? "" : String(v.stock),
    stockLoaded: v.stock == null ? "" : String(v.stock),
    prices: pricesToFormValues(v.prices, currencies),
  })),
});

/** SKU, stock and prices of each variant; saved together with one button. */
export function VariantsEditor({
  productId,
  variants,
  currencies,
}: {
  productId: string;
  variants: Variant[];
  currencies: FormCurrency[];
}) {
  const storeId = useStoreId();
  const t = useTranslations("Products.variants");
  const tf = useTranslations("Products.form");
  const tv = useTranslations("Validation");
  const locale = useLocale();
  const router = useRouter();
  const hydrated = useHydrated();
  const [open, setOpen] = useState<Set<number>>(new Set());
  // Read-only (the card toggles are disabled with the form): show every variant open
  const readOnly = useInheritedDisabled();
  const [formError, setFormError] = useState<string | null>(null);
  const schema = useMemo(() => createVariantsSchema(tv, currencies), [tv, currencies]);
  const form = useForm<VariantsFormValues>({ resolver: zodResolver(schema), defaultValues: toValues(variants, currencies) });

  // New variants (after the options were saved) come back from the server
  const signature = JSON.stringify(variants);
  useEffect(() => {
    form.reset(toValues(JSON.parse(signature) as Variant[], currencies));
  }, [signature, currencies, form]);

  const baseCurrency = currencies.find((c) => c.isBase) ?? currencies[0];
  const baseIndex = currencies.indexOf(baseCurrency);
  const watched = form.watch("variants");

  const toggle = (index: number) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });

  // Cards with errors open, so the merchant sees what to fix
  function openErrors(errors: FieldErrors<VariantsFormValues>) {
    const withErrors = (errors.variants ?? []) as unknown[];
    setOpen((current) => new Set([...current, ...withErrors.flatMap((error, i) => (error ? [i] : []))]));
    setFormError(t("fixErrors"));
  }

  async function onSubmit(values: VariantsFormValues) {
    setFormError(null);
    const result = await saveVariantsAction(storeId, productId, values, locale);
    if (result.ok) {
      toast.success(t("saved"));
      router.refresh();
      return;
    }
    if (result.error === "skuTaken") {
      for (const i of result.indexes ?? []) form.setError(`variants.${i}.sku`, { message: tv("skuTaken") });
      setOpen((current) => new Set([...current, ...(result.indexes ?? [])]));
    }
    if (result.error === "stale") router.refresh();
    const key = ["forbidden", "stale", "notFound", "skuTaken"].includes(result.error) ? result.error : "failed";
    setFormError(t(`errors.${key as "forbidden" | "stale" | "notFound" | "skuTaken" | "failed"}`));
  }

  return (
    <section className="flex flex-col gap-4" aria-labelledby="variants-title">
      <div>
        <h2 id="variants-title" className="text-lg font-semibold">
          {t("title", { count: variants.length })}
        </h2>
        <p className="text-sm text-muted-foreground">{t("help")}</p>
      </div>

      <form onSubmit={form.handleSubmit(onSubmit, openErrors)} method="post" noValidate className="flex flex-col gap-3">
        <ul className="flex flex-col gap-2">
          {variants.map((variant, index) => {
            const expanded = readOnly || open.has(index);
            const current = watched[index];
            const price = current?.prices[baseIndex]?.price;
            const stock = current?.stock;
            const regionId = `variant-${variant.id}`;
            return (
              <li key={variant.id} className="rounded-lg border" data-variant={variant.title ?? ""}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-3 p-3 text-left"
                  aria-expanded={expanded}
                  aria-controls={regionId}
                  onClick={() => toggle(index)}
                >
                  <span className="font-medium">{variant.title}</span>
                  <span className="flex items-center gap-3 text-sm text-muted-foreground">
                    <span>{price ? `${price} ${baseCurrency.code}` : t("noPrice")}</span>
                    <span>{stock === "" || stock === undefined ? t("stockUntracked") : t("stock", { count: Number(stock) })}</span>
                    <span aria-hidden>{expanded ? "▴" : "▾"}</span>
                  </span>
                </button>
                {/* Collapsed cards stay mounted (hidden), so their fields keep validating */}
                <div id={regionId} hidden={!expanded} className="flex flex-col gap-4 border-t p-3">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <TextField
                      control={form.control}
                      name={`variants.${index}.sku`}
                      label={tf("sku")}
                      placeholder={tf("skuPlaceholder")}
                      autoComplete="off"
                    />
                    <TextField
                      control={form.control}
                      name={`variants.${index}.stock`}
                      label={tf("stock")}
                      description={tf("stockHelp")}
                      placeholder={tf("stockPlaceholder")}
                      inputMode="numeric"
                      autoComplete="off"
                    />
                  </div>
                  <VariantPrices control={form.control} base={`variants.${index}.prices`} currencies={currencies} />
                </div>
              </li>
            );
          })}
        </ul>

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
      </form>
    </section>
  );
}
