"use client";

import { useStoreId, useStorePath } from "@/components/panel-scope";
import { useEffect, useMemo, useState } from "react";
import { Controller, useForm, type Path } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Link, useRouter } from "@/i18n/navigation";
import { MAX_IMAGES_PER_PRODUCT } from "@/lib/images";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { TextField, VariantPrices } from "./price-fields";
import { ProductImagesField } from "./product-images-field";

type Props = {
  /** edit mode when `productId` is given */
  productId?: string;
  initialValues: ProductFormValues;
  currencies: FormCurrency[];
  categories: { id: string; name: string }[];
  /** false: the product has options; its price and stock are edited per variant, not here */
  simple?: boolean;
  /** url of each saved image, by id (the images themselves are `initialValues.images`) */
  imageUrls?: Record<string, string>;
};

/** The "no category" item; the form value for it is "" */
const NO_CATEGORY = "__none__";

export function ProductForm({ productId, initialValues, currencies, categories, simple = true, imageUrls = {} }: Props) {
  const storeId = useStoreId();
  const t = useTranslations("Products.form");
  const panelPath = useStorePath();
  const tv = useTranslations("Validation");
  const locale = useLocale();
  const router = useRouter();
  const hydrated = useHydrated();
  const [formError, setFormError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const categoryNames = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories]);

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
      ? await updateProductAction(storeId, productId, values, locale)
      : await createProductAction(storeId, values, locale);

    if (result.ok) {
      // A new product continues on its edit page, where options can be added (and a notice
      // there says it was created); an edited one goes back to the list
      if (productId) toast.success(t("toasts.saved", { name: values.name.trim() }));
      router.push(productId ? panelPath("/products") : panelPath(`/products/${result.id}/edit?created=1`));
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
      case "imagesStale":
      case "imagesLimit":
        form.setError("images", { message: t(`errors.${result.error}`, { max: MAX_IMAGES_PER_PRODUCT }) });
        return;
      default:
        setFormError(t(`errors.${result.error}`));
    }
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} method="post" noValidate>
      <FieldGroup>
        {/* ---- basics */}
        <TextField control={form.control} name="name" label={t("name")} placeholder={t("namePlaceholder")} />
        <Controller
          name="description"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor="description">{t("description")}</FieldLabel>
              <Textarea
                {...field}
                id="description"
                rows={4}
                placeholder={t("descriptionPlaceholder")}
                aria-invalid={fieldState.invalid}
              />
              <FieldError errors={[fieldState.error]} />
            </Field>
          )}
        />
        <ProductImagesField
          form={form}
          productName={name.trim() || t("imageAltFallback")}
          savedUrls={imageUrls}
          onBusyChange={setUploading}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Controller
            name="categoryId"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor="categoryId">{t("category")}</FieldLabel>
                <Select
                  value={field.value || NO_CATEGORY}
                  onValueChange={(value) => field.onChange(typeof value === "string" && value !== NO_CATEGORY ? value : "")}
                >
                  <SelectTrigger
                    ref={field.ref}
                    id="categoryId"
                    aria-invalid={fieldState.invalid || undefined}
                    onBlur={field.onBlur}
                    className="w-full"
                  >
                    <SelectValue>
                      {(value: string) => categoryNames.get(value) ?? t("noCategory")}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_CATEGORY}>{t("noCategory")}</SelectItem>
                    {categories.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {categories.length === 0 && (
                  <FieldDescription>
                    <Link href={panelPath("/categories")} className="underline underline-offset-4">
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
                <Select value={field.value} onValueChange={(value) => value && field.onChange(value)}>
                  <SelectTrigger
                    ref={field.ref}
                    id="status"
                    aria-invalid={fieldState.invalid || undefined}
                    onBlur={field.onBlur}
                    className="w-full"
                  >
                    <SelectValue>{(value: ProductFormValues["status"]) => t(`statuses.${value}`)}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {PRODUCT_STATUS_VALUES.map((status) => (
                      <SelectItem key={status} value={status}>
                        {t(`statuses.${status}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
              <VariantPrices control={form.control} base="prices" currencies={currencies} />
            </section>

            {/* ---- inventory */}
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                control={form.control}
                name="sku"
                label={t("sku")}
                description={t("skuHelp")}
                placeholder={t("skuPlaceholder")}
                autoComplete="off"
              />
              <TextField
                control={form.control}
                name="stock"
                label={t("stock")}
                description={t("stockHelp")}
                placeholder={t("stockPlaceholder")}
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
            placeholder={t("slugPlaceholder")}
            autoCapitalize="none"
            autoComplete="off"
          />
          <TextField
            control={form.control}
            name="tags"
            label={t("tags")}
            description={t("tagsHelp")}
            placeholder={t("tagsPlaceholder")}
            autoComplete="off"
          />
          <TextField
            control={form.control}
            name="metaTitle"
            label={t("metaTitle")}
            description={t("metaTitleHelp", { count: form.watch("metaTitle").length })}
            placeholder={t("metaTitlePlaceholder")}
          />
          <Controller
            name="metaDescription"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor="metaDescription">{t("metaDescription")}</FieldLabel>
                <Textarea
                  {...field}
                  id="metaDescription"
                  rows={2}
                  placeholder={t("metaDescriptionPlaceholder")}
                  aria-invalid={fieldState.invalid}
                />
                <FieldDescription>{t("metaDescriptionHelp", { count: field.value.length })}</FieldDescription>
                <FieldError errors={[fieldState.error]} />
              </Field>
            )}
          />
        </section>

        {formError && <FieldError>{formError}</FieldError>}

        <div className="flex gap-2">
          <Button type="submit" disabled={!hydrated || uploading || form.formState.isSubmitting}>
            {uploading ? t("waitingImages") : form.formState.isSubmitting ? t("saving") : t("save")}
          </Button>
          <Link href={panelPath("/products")} className={buttonVariants({ variant: "outline" })}>
            {t("cancel")}
          </Link>
        </div>
      </FieldGroup>
    </form>
  );
}
