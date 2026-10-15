"use client";

import { useMemo, useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { FOOTER_TEXT_MAX } from "@/lib/footer";
import { useHydrated } from "@/lib/use-hydrated";
import { createFooterTextSchema, type FooterTextValues } from "@/lib/validation/footer";
import { updateFooterTextAction } from "@/server/catalog-actions";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";

/** The short text shown under the store's logo + name in the storefront footer. */
export function FooterTextForm({ initialValues }: { initialValues: FooterTextValues }) {
  const t = useTranslations("Settings.footer.about");
  const tv = useTranslations("Validation");
  const locale = useLocale();
  const router = useRouter();
  const hydrated = useHydrated();
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const schema = useMemo(() => createFooterTextSchema(tv), [tv]);
  const form = useForm<FooterTextValues>({ resolver: zodResolver(schema), defaultValues: initialValues });
  const length = useWatch({ control: form.control, name: "footerText" }).length;

  async function onSubmit(values: FooterTextValues) {
    setStatus(null);
    const result = await updateFooterTextAction(values, locale);
    if (result.ok) {
      setStatus({ ok: true, text: t("saved") });
      router.refresh();
    } else if (result.error === "invalid") {
      for (const [field, messages] of Object.entries(result.fieldErrors ?? {})) {
        form.setError(field as keyof FooterTextValues, { message: messages[0] });
      }
    } else {
      setStatus({ ok: false, text: t(`errors.${result.error === "forbidden" ? "forbidden" : "failed"}`) });
    }
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} method="post" noValidate>
      <FieldGroup>
        <Controller
          name="footerText"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor="footerText">{t("text")}</FieldLabel>
              <Textarea
                {...field}
                id="footerText"
                rows={4}
                placeholder={t("placeholder")}
                aria-invalid={fieldState.invalid}
                aria-describedby="footerText-help footerText-count"
              />
              <div className="flex gap-4">
                <FieldDescription id="footerText-help">{t("help")}</FieldDescription>
                <span
                  id="footerText-count"
                  className={`ml-auto shrink-0 text-xs tabular-nums ${length > FOOTER_TEXT_MAX ? "text-destructive" : "text-muted-foreground"}`}
                >
                  {length}/{FOOTER_TEXT_MAX}
                </span>
              </div>
              <FieldError errors={[fieldState.error]} />
            </Field>
          )}
        />
        {status && (
          <p role="status" className={status.ok ? "text-sm text-muted-foreground" : "text-sm text-destructive"}>
            {status.text}
          </p>
        )}
        <div>
          <Button type="submit" disabled={!hydrated || form.formState.isSubmitting}>
            {form.formState.isSubmitting ? t("saving") : t("save")}
          </Button>
        </div>
      </FieldGroup>
    </form>
  );
}
