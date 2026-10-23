"use client";

import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { useStoreId } from "@/components/panel-scope";
import { useCan } from "@/components/permissions/permissions-provider";
import { useRouter } from "@/i18n/navigation";
import { formatMoney, minorToInput } from "@/lib/money";
import { useHydrated } from "@/lib/use-hydrated";
import { createOpenRegisterSchema, type OpenRegisterValues } from "@/lib/validation/register";
import { openRegisterAction } from "@/server/register-actions";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { Textarea } from "@/components/ui/textarea";

type Currency = { code: string; digits: number };

/**
 * Opens the register: the cash in the drawer per currency, prefilled with what the last close
 * counted (`suggested`), which is usually what was left for change.
 */
export function OpenRegisterForm({ currencies, suggested }: { currencies: Currency[]; suggested: Record<string, number> }) {
  const storeId = useStoreId();
  const t = useTranslations("Register.open");
  const tr = useTranslations("Register");
  const tv = useTranslations("Validation");
  const locale = useLocale();
  const router = useRouter();
  const hydrated = useHydrated();
  const can = useCan();
  const [message, setMessage] = useState<string | null>(null);

  const form = useForm<OpenRegisterValues>({
    resolver: zodResolver(createOpenRegisterSchema(tv, currencies)),
    defaultValues: {
      floats: Object.fromEntries(currencies.map((c) => [c.code, suggested[c.code] ? minorToInput(suggested[c.code], c.digits) : ""])),
      note: "",
    },
  });

  if (!can({ register: ["create"] })) return <p className="text-sm text-muted-foreground">{t("notAllowed")}</p>;

  async function onSubmit(values: OpenRegisterValues) {
    setMessage(null);
    const result = await openRegisterAction(storeId, values, locale).catch(() => null);
    if (result?.ok) {
      toast.success(t("toast"));
      router.refresh();
      return;
    }
    if (result?.error === "invalid" && "fieldErrors" in result && result.fieldErrors) {
      for (const [field, messages] of Object.entries(result.fieldErrors)) form.setError(field as `floats.${string}`, { message: messages[0] });
      return;
    }
    setMessage(tr(`errors.${result && !result.ok ? result.error : "failed"}`));
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} method="post" noValidate className="flex flex-col gap-4">
      <FieldGroup>
        <div className="grid gap-4 sm:grid-cols-2">
          {currencies.map((c) => (
            <Controller
              key={c.code}
              name={`floats.${c.code}`}
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor={`float-${c.code}`}>{t("float", { currency: c.code })}</FieldLabel>
                  <InputGroup>
                    <InputGroupInput
                      {...field}
                      id={`float-${c.code}`}
                      inputMode="decimal"
                      autoComplete="off"
                      placeholder={minorToInput(c.digits === 0 ? 500 : 5000, c.digits)}
                      aria-invalid={fieldState.invalid}
                    />
                    <InputGroupAddon align="inline-end">
                      <InputGroupText>{c.code}</InputGroupText>
                    </InputGroupAddon>
                  </InputGroup>
                  {suggested[c.code] !== undefined && (
                    <FieldDescription>{t("lastCounted", { amount: formatMoney(suggested[c.code], c.code, locale) })}</FieldDescription>
                  )}
                  <FieldError errors={[fieldState.error]} />
                </Field>
              )}
            />
          ))}
        </div>
        <Controller
          name="note"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor="open-note">{tr("note")}</FieldLabel>
              <Textarea {...field} id="open-note" rows={2} placeholder={t("notePlaceholder")} aria-invalid={fieldState.invalid} />
              <FieldError errors={[fieldState.error]} />
            </Field>
          )}
        />
      </FieldGroup>
      {message && (
        <p role="alert" className="text-sm text-destructive">
          {message}
        </p>
      )}
      <Button type="submit" className="self-start" disabled={!hydrated || form.formState.isSubmitting}>
        {t("submit")}
      </Button>
    </form>
  );
}
