"use client";

import { useMemo, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { useHydrated } from "@/lib/use-hydrated";
import { createLoginSchema, type LoginValues } from "@/lib/validation/auth";
import { customerLoginAction } from "@/server/customer-account-actions";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/password-input";

/** Sign-in on the store's subdomain; `next` is an already-sanitized path to return to. */
export function CustomerLoginForm({ next }: { next: string }) {
  const t = useTranslations("Store.account.login");
  const tv = useTranslations("Validation");
  const locale = useLocale();
  const router = useRouter();
  const hydrated = useHydrated();
  const [formError, setFormError] = useState<string | null>(null);

  const schema = useMemo(() => createLoginSchema(tv), [tv]);
  const form = useForm<LoginValues>({ resolver: zodResolver(schema), defaultValues: { email: "", password: "" } });

  async function onSubmit(values: LoginValues) {
    setFormError(null);
    const result = await customerLoginAction(values, locale).catch(() => null);
    if (result?.ok) {
      router.replace(next);
      router.refresh();
    } else if (result?.error === "invalid") {
      for (const [name, messages] of Object.entries(result.fieldErrors)) {
        form.setError(name as keyof LoginValues, { message: messages[0] });
      }
    } else {
      const key = result?.error === "invalidCredentials" || result?.error === "tooManyAttempts" ? result.error : "failed";
      setFormError(t(`errors.${key}`));
    }
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} method="post" noValidate>
      <FieldGroup>
        <Controller
          name="email"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor="email">{t("email")}</FieldLabel>
              <Input {...field} id="email" type="email" autoComplete="email" aria-invalid={fieldState.invalid} />
              <FieldError errors={[fieldState.error]} />
            </Field>
          )}
        />
        <Controller
          name="password"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor="password">{t("password")}</FieldLabel>
              <PasswordInput {...field} id="password" autoComplete="current-password" aria-invalid={fieldState.invalid} />
              <FieldError errors={[fieldState.error]} />
            </Field>
          )}
        />
        {formError && <FieldError>{formError}</FieldError>}
        <Button
          type="submit"
          disabled={!hydrated || form.formState.isSubmitting}
          style={{ backgroundColor: "var(--brand)", color: "var(--brand-foreground)" }}
        >
          {form.formState.isSubmitting ? t("submitting") : t("submit")}
        </Button>
      </FieldGroup>
    </form>
  );
}
