"use client";

import { useMemo, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useLocale, useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import { useHydrated } from "@/lib/use-hydrated";
import {
  createProductSchema,
  PRODUCT_STATUS_VALUES,
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
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type Props = {
  /** edit mode when `productId` is given */
  productId?: string;
  initialValues: ProductFormValues;
  currency: string;
  currencyDigits: number;
};

export function ProductForm({ productId, initialValues, currency, currencyDigits }: Props) {
  const t = useTranslations("Products.form");
  const tv = useTranslations("Validation");
  const locale = useLocale();
  const router = useRouter();
  const hydrated = useHydrated();
  const [formError, setFormError] = useState<string | null>(null);

  const schema = useMemo(() => createProductSchema(tv, currencyDigits), [tv, currencyDigits]);
  const form = useForm<ProductFormValues>({
    resolver: zodResolver(schema),
    defaultValues: initialValues,
  });

  async function onSubmit(values: ProductFormValues) {
    setFormError(null);
    const result = productId
      ? await updateProductAction(productId, values, locale)
      : await createProductAction(values, locale);

    if (result.ok) {
      // A new product continues on its edit page, where images can be added
      router.push(
        productId ? "/dashboard/products" : `/dashboard/products/${result.id}/edit?created=1`,
      );
      router.refresh();
      return;
    }
    if (result.error === "invalid") {
      for (const [name, messages] of Object.entries(result.fieldErrors ?? {})) {
        form.setError(name as keyof ProductFormValues, { message: messages[0] });
      }
      return;
    }
    setFormError(t(`errors.${result.error}`));
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} method="post" noValidate>
      <FieldGroup>
        <Controller
          name="name"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor="name">{t("name")}</FieldLabel>
              <Input {...field} id="name" aria-invalid={fieldState.invalid} />
              <FieldError errors={[fieldState.error]} />
            </Field>
          )}
        />

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
                aria-invalid={fieldState.invalid}
              />
              <FieldError errors={[fieldState.error]} />
            </Field>
          )}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <Controller
            name="price"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor="price">{t("price", { currency })}</FieldLabel>
                <Input
                  {...field}
                  id="price"
                  inputMode="decimal"
                  autoComplete="off"
                  aria-invalid={fieldState.invalid}
                />
                <FieldError errors={[fieldState.error]} />
              </Field>
            )}
          />
          <Controller
            name="stock"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor="stock">{t("stock")}</FieldLabel>
                <Input
                  {...field}
                  id="stock"
                  inputMode="numeric"
                  autoComplete="off"
                  aria-invalid={fieldState.invalid}
                />
                <FieldDescription>{t("stockHelp")}</FieldDescription>
                <FieldError errors={[fieldState.error]} />
              </Field>
            )}
          />
        </div>

        <Controller
          name="status"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor="status">{t("status")}</FieldLabel>
              <select
                {...field}
                id="status"
                aria-invalid={fieldState.invalid}
                className={cn(
                  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-base outline-none transition-colors md:text-sm",
                  "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
                  "aria-invalid:border-destructive dark:bg-input/30",
                )}
              >
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

        {formError && <FieldError>{formError}</FieldError>}

        <div className="flex gap-2">
          <Button type="submit" disabled={!hydrated || form.formState.isSubmitting}>
            {form.formState.isSubmitting ? t("saving") : t("save")}
          </Button>
          <Link
            href="/dashboard/products"
            className={buttonVariants({ variant: "outline" })}
          >
            {t("cancel")}
          </Link>
        </div>
      </FieldGroup>
    </form>
  );
}
