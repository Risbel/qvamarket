"use client";

import { useEffect, useMemo, useState } from "react";
import { Controller, useFieldArray, useForm, useFormState, type Control } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { useHydrated } from "@/lib/use-hydrated";
import {
  createOptionsSchema,
  MAX_OPTION_VALUES,
  MAX_OPTIONS,
  type OptionsFormValues,
} from "@/lib/validation/product";
import { setProductOptionsAction } from "@/server/variant-actions";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { TextField } from "../../price-fields";

type Option = { id: string; name: string; values: { id: string; value: string }[] };

const toValues = (options: Option[]): OptionsFormValues => ({
  options: options.map((o) => ({ id: o.id, name: o.name, values: o.values.map((v) => ({ id: v.id, value: v.value })) })),
});

/**
 * Options of a product (e.g. Talla: S, M, L). Saving regenerates the variants on the server;
 * each combination of values is a variant with its own price and stock.
 */
export function OptionsEditor({ productId, options }: { productId: string; options: Option[] }) {
  const t = useTranslations("Products.options");
  const tv = useTranslations("Validation");
  const locale = useLocale();
  const router = useRouter();
  const hydrated = useHydrated();
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const schema = useMemo(() => createOptionsSchema(tv), [tv]);
  const form = useForm<OptionsFormValues>({ resolver: zodResolver(schema), defaultValues: toValues(options) });
  const fields = useFieldArray({ control: form.control, name: "options" });

  // After a save the server sends the options back with their new ids
  const signature = JSON.stringify(options);
  useEffect(() => {
    form.reset(toValues(JSON.parse(signature) as Option[]));
  }, [signature, form]);

  const watched = form.watch("options");
  const combinations = watched.reduce((total, option) => total * Math.max(option.values.length, 1), 1);
  const rootError = form.formState.errors.options?.root?.message ?? form.formState.errors.options?.message;

  async function onSubmit(values: OptionsFormValues) {
    setStatus(null);
    const result = await setProductOptionsAction(productId, values, locale);
    if (result.ok) {
      setStatus({ ok: true, text: t("saved") });
      router.refresh();
      return;
    }
    if (result.error === "stale") router.refresh();
    setStatus({
      ok: false,
      text: t(`errors.${result.error === "forbidden" || result.error === "stale" || result.error === "notFound" ? result.error : "failed"}`),
    });
  }

  return (
    <section className="flex flex-col gap-4" aria-labelledby="options-title">
      <div>
        <h2 id="options-title" className="text-lg font-semibold">
          {t("title")}
        </h2>
        <p className="text-sm text-muted-foreground">{t("help")}</p>
      </div>

      <form onSubmit={form.handleSubmit(onSubmit)} method="post" noValidate className="flex flex-col gap-4">
        {fields.fields.map((field, index) => (
          <OptionCard
            key={field.id}
            control={form.control}
            index={index}
            onRemove={() => fields.remove(index)}
          />
        ))}

        {fields.fields.length < MAX_OPTIONS && (
          <Button
            type="button"
            variant="outline"
            className="w-fit"
            onClick={() => fields.append({ id: "", name: "", values: [{ id: "", value: "" }] })}
          >
            {fields.fields.length === 0 ? t("addFirst") : t("add")}
          </Button>
        )}

        {fields.fields.length > 0 && (
          <p className="text-sm text-muted-foreground" data-testid="combinations">
            {t("combinations", { count: combinations })}
          </p>
        )}
        {options.length > 0 && fields.fields.length === 0 && (
          <p className="rounded-md bg-muted p-3 text-sm">{t("backToSimple")}</p>
        )}
        {rootError && <FieldError>{rootError}</FieldError>}
        {status && (
          <p role="status" className={status.ok ? "text-sm text-muted-foreground" : "text-sm text-destructive"}>
            {status.text}
          </p>
        )}
        <div>
          <Button type="submit" disabled={!hydrated || form.formState.isSubmitting || !form.formState.isDirty}>
            {form.formState.isSubmitting ? t("saving") : t("save")}
          </Button>
        </div>
      </form>
    </section>
  );
}

function OptionCard({
  control,
  index,
  onRemove,
}: {
  control: Control<OptionsFormValues>;
  index: number;
  onRemove: () => void;
}) {
  const t = useTranslations("Products.options");
  const values = useFieldArray({ control, name: `options.${index}.values` });
  const { errors } = useFormState({ control, name: `options.${index}.values` });
  const valuesError = errors.options?.[index]?.values;
  const listMessage = valuesError?.root?.message ?? valuesError?.message;

  return (
    <fieldset className="flex flex-col gap-3 rounded-lg border p-4" data-option={index}>
      <legend className="sr-only">{t("optionLegend", { number: index + 1 })}</legend>
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <TextField
            control={control}
            name={`options.${index}.name`}
            label={t("name")}
            placeholder={t("namePlaceholder")}
            autoComplete="off"
          />
        </div>
        <Button type="button" variant="outline" size="sm" className="mb-1" onClick={onRemove}>
          {t("remove")}
        </Button>
      </div>

      <Field data-invalid={Boolean(listMessage)}>
        <FieldLabel>{t("values")}</FieldLabel>
        <div className="flex flex-wrap gap-2">
          {values.fields.map((value, k) => (
            <Controller
              key={value.id}
              control={control}
              name={`options.${index}.values.${k}.value`}
              render={({ field, fieldState: valueState }) => (
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-1">
                    <Input
                      {...field}
                      aria-label={t("valueLabel", { number: k + 1 })}
                      aria-invalid={valueState.invalid}
                      placeholder={t("valuePlaceholder")}
                      autoComplete="off"
                      className="w-28"
                      onKeyDown={(event) => {
                        // Enter adds the next value instead of submitting the form
                        if (event.key === "Enter") {
                          event.preventDefault();
                          if (values.fields.length < MAX_OPTION_VALUES) values.append({ id: "", value: "" });
                        }
                      }}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={t("removeValue", { value: field.value || k + 1 })}
                      disabled={values.fields.length === 1}
                      onClick={() => values.remove(k)}
                    >
                      ×
                    </Button>
                  </div>
                  {valueState.error && <FieldError errors={[valueState.error]} />}
                </div>
              )}
            />
          ))}
          {values.fields.length < MAX_OPTION_VALUES && (
            <Button type="button" variant="outline" size="sm" onClick={() => values.append({ id: "", value: "" })}>
              {t("addValue")}
            </Button>
          )}
        </div>
        {listMessage && <FieldError>{listMessage}</FieldError>}
      </Field>
    </fieldset>
  );
}
