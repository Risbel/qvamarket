"use client";

import { useMemo, useState } from "react";
import { Controller, useForm, type Control } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { useHydrated } from "@/lib/use-hydrated";
import {
  createChangePasswordSchema,
  type ChangePasswordValues,
} from "@/lib/validation/auth";
import { changePasswordAction } from "@/server/account-actions";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

export function ChangePasswordForm() {
  const t = useTranslations("ChangePassword");
  const tv = useTranslations("Validation");
  const locale = useLocale();
  const router = useRouter();
  const hydrated = useHydrated();
  const [formError, setFormError] = useState<string | null>(null);

  const schema = useMemo(() => createChangePasswordSchema(tv), [tv]);
  const form = useForm<ChangePasswordValues>({
    resolver: zodResolver(schema),
    defaultValues: { currentPassword: "", newPassword: "", confirmPassword: "" },
  });

  async function onSubmit(values: ChangePasswordValues) {
    setFormError(null);
    const result = await changePasswordAction(values, locale);

    if (result.ok) {
      router.push("/dashboard");
      router.refresh();
      return;
    }
    if (result.error === "invalidCurrent") {
      form.setError("currentPassword", { message: t("errors.invalidCurrent") });
    } else if (result.error === "invalid") {
      for (const [name, messages] of Object.entries(result.fieldErrors ?? {})) {
        form.setError(name as keyof ChangePasswordValues, { message: messages[0] });
      }
    } else {
      setFormError(t(`errors.${result.error}`));
    }
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} method="post" noValidate>
      <FieldGroup>
        <PasswordField
          control={form.control}
          name="currentPassword"
          label={t("currentPassword")}
          autoComplete="current-password"
        />
        <PasswordField
          control={form.control}
          name="newPassword"
          label={t("newPassword")}
          autoComplete="new-password"
        />
        <PasswordField
          control={form.control}
          name="confirmPassword"
          label={t("confirmPassword")}
          autoComplete="new-password"
        />
        {formError && <FieldError>{formError}</FieldError>}
        <Button type="submit" disabled={!hydrated || form.formState.isSubmitting}>
          {form.formState.isSubmitting ? t("submitting") : t("submit")}
        </Button>
      </FieldGroup>
    </form>
  );
}

function PasswordField({
  control,
  name,
  label,
  autoComplete,
}: {
  control: Control<ChangePasswordValues>;
  name: keyof ChangePasswordValues;
  label: string;
  autoComplete: string;
}) {
  return (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid}>
          <FieldLabel htmlFor={name}>{label}</FieldLabel>
          <Input
            {...field}
            id={name}
            type="password"
            autoComplete={autoComplete}
            aria-invalid={fieldState.invalid}
          />
          <FieldError errors={[fieldState.error]} />
        </Field>
      )}
    />
  );
}
