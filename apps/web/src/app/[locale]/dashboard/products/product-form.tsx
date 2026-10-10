"use client";

import { useEffect, useMemo, useState } from "react";
import { Controller, useForm, type Path } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useLocale, useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import { slugify } from "@/lib/slug";
import { useHydrated } from "@/lib/use-hydrated";
import {
  createProductSchema,
  PRODUCT_STATUS_VALUES,
  type FormCurrency,
  type ProductFormValues,
} from "@/lib/validation/product";
import {
  createProductAction,
  updateProductAction,
} from "@/server/product-actions";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { CurrencyPrices, TextField } from "./price-fields";

type Props = {
  /** edit mode when `productId` is given */
  productId?: string;
  initialValues: ProductFormValues;
  currencies: FormCurrency[];
  categories: { id: string; name: string }[];
  /** false: the product has options; its price and stock are edited per variant, not here */
  simple?: boolean;
};

const selectClass = cn(
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-base outline-none transition-colors md:text-sm",
  "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
  "aria-invalid:border-destructive dark:bg-input/30",
);

export function ProductForm({ productId, initialValues, currencies, categories, simple = true }: Props) {
  const t = useTranslations("Products.form");
  const tv = useTranslations("Validation");
  const locale = useLocale();
  const router = useRouter();
  const hydrated = useHydrated();
  const [formError, setFormError] = useState<string | null>(null);

  const schema = useMemo(() => createProductSchema(tv, currencies, { simple }), [tv, currencies, simple]);
  const form = useForm<ProductFormValues>({
    resolver: zodResolver(schema),
    defaultValues: initialValues,
  });

  // New products: the URL slug follows the name until the merchant edits it
  const name = form.watch("name");
  const slug = form.watch("slug");
  const slugDirty = form.formState.dirtyFields.slug;
  useEffect(() => {
    if (!productId && !slugDirty) form.setValue("slug", slugify(name));
  }, [name, slugDirty, productId, form]);

  async function onSubmit(values: ProductFormValues) {
    setFormError(null);
    const result = productId
      ? await updateProductAction(productId, values, locale)
      : await createProductAction(values, locale);

    if (result.ok) {
      // A new product continues on its edit page, where images can be added
      router.push(productId ? "/dashboard/products" : `/dashboard/products/${result.id}/edit?created=1`);
      router.refresh();
      return;
    }
    switch (result.error) {
      case "invalid":
        for (const [field, messages] of Object.entries(result.fieldErrors ?? {})) {
          form.setError(field as Path<ProductFormValues>, { message: messages[0] });
        }
        return;
      case "slugTaken":
        form.setError("slug", { message: tv("productSlugTaken") });
        return;
      case "skuTaken":
        form.setError("sku", { message: tv("skuTaken") });
        return;
      case "categoryNotFound":
        form.setError("categoryId", { message: t("errors.categoryNotFound") });
        return;
      default:
        setFormError(t(`errors.${result.error}`));
    }
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} method="post" noValidate>
      <FieldGroup>
        {/* ---- basics */}
        <TextField control={form.control} name="name" label={t("name")} />
        <Controller
          name="description"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor="description">{t("description")}</FieldLabel>
              <Textarea {...field} id="description" rows={4} aria-invalid={fieldState.invalid} />
              <FieldError errors={[fieldState.error]} />
            </Field>
          )}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Controller
            name="categoryId"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor="categoryId">{t("category")}</FieldLabel>
                <select {...field} id="categoryId" aria-invalid={fieldState.invalid} className={selectClass}>
                  <option value="">{t("noCategory")}</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                {categories.length === 0 && (
                  <FieldDescription>
                    <Link href="/dashboard/categories" className="underline underline-offset-4">
                      {t("createCategories")}
                    </Link>
                  </FieldDescription>
                )}
                <FieldError errors={[fieldState.error]} />
              </Field>
            )}
          />
          <Controller
            name="status"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor="status">{t("status")}</FieldLabel>
                <select {...field} id="status" aria-invalid={fieldState.invalid} className={selectClass}>
                  {PRODUCT_STATUS_VALUES.map((status) => (
                    <option key={status} value={status}>
                      {t(`statuses.${status}`)}
                    </option>
                  ))}
                </select>
                <FieldDescription>{t(`statusHelp.${field.value}`)}</FieldDescription>
                <FieldError errors={[fieldState.error]} />
              </Field>
            )}
          />
        </div>

        {simple ? (
          <>
            {/* ---- prices, one card per currency of the store */}
            <section className="flex flex-col gap-3" aria-labelledby="prices-title">
              <div>
                <h2 id="prices-title" className="text-base font-semibold">
                  {t("pricesTitle")}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {currencies.length > 1 ? t("pricesHelpMulti") : t("pricesHelp")}
                </p>
              </div>
              {currencies.map((currency, index) => (
                <CurrencyPrices key={currency.code} control={form.control} base={`prices.${index}`} currency={currency} />
              ))}
            </section>

            {/* ---- inventory */}
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField control={form.control} name="sku" label={t("sku")} description={t("skuHelp")} autoComplete="off" />
              <TextField
                control={form.control}
                name="stock"
                label={t("stock")}
                description={t("stockHelp")}
                inputMode="numeric"
                autoComplete="off"
              />
            </div>
          </>
        ) : (
          <p className="rounded-md bg-muted p-3 text-sm">{t("pricesInVariants")}</p>
        )}

        {/* ---- search and SEO */}
        <section className="flex flex-col gap-4" aria-labelledby="seo-title">
          <div>
            <h2 id="seo-title" className="text-base font-semibold">
              {t("seoTitle")}
            </h2>
            <p className="text-sm text-muted-foreground">{t("seoHelp")}</p>
          </div>
          <TextField
            control={form.control}
            name="slug"
            label={t("slug")}
            description={t("slugHelp", { path: `/products/${slug || "..."}` })}
            autoCapitalize="none"
            autoComplete="off"
          />
          <TextField control={form.control} name="tags" label={t("tags")} description={t("tagsHelp")} autoComplete="off" />
          <TextField
            control={form.control}
            name="metaTitle"
            label={t("metaTitle")}
            description={t("metaTitleHelp", { count: form.watch("metaTitle").length })}
          />
          <Controller
            name="metaDescription"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor="metaDescription">{t("metaDescription")}</FieldLabel>
                <Textarea {...field} id="metaDescription" rows={2} aria-invalid={fieldState.invalid} />
                <FieldDescription>{t("metaDescriptionHelp", { count: field.value.length })}</FieldDescription>
                <FieldError errors={[fieldState.error]} />
              </Field>
            )}
          />
        </section>

        {formError && <FieldError>{formError}</FieldError>}

        <div className="flex gap-2">
          <Button type="submit" disabled={!hydrated || form.formState.isSubmitting}>
            {form.formState.isSubmitting ? t("saving") : t("save")}
          </Button>
          <Link href="/dashboard/products" className={buttonVariants({ variant: "outline" })}>
            {t("cancel")}
          </Link>
        </div>
      </FieldGroup>
    </form>
  );
}
