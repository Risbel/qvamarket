"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { useHydrated } from "@/lib/use-hydrated";
import { createCustomerSignupSchema, type CustomerSignupValues } from "@/lib/validation/customer-account";
import { customerSignupAction } from "@/server/customer-account-actions";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

type FieldName = keyof CustomerSignupValues;

/** Account creation on the store's subdomain; `next` is an already-sanitized path. */
export function CustomerSignupForm({ next }: { next: string }) {
  const t = useTranslations("Store.account.signup");
  const tv = useTranslations("Validation");
  const locale = useLocale();
  const router = useRouter();
  const hydrated = useHydrated();
  const [formError, setFormError] = useState<string | null>(null);

  // Anti-bot, as in merchant signup: a hidden field humans never fill, and the fill time
  const [honeypot, setHoneypot] = useState("");
  const shownAt = useRef(0);
  useEffect(() => {
    shownAt.current = Date.now();
  }, []);

  const schema = useMemo(() => createCustomerSignupSchema(tv), [tv]);
  const form = useForm<CustomerSignupValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", email: "", password: "", confirmPassword: "" },
  });

  async function onSubmit(values: CustomerSignupValues) {
    setFormError(null);
    const result = await customerSignupAction(values, { honeypot, elapsedMs: Date.now() - shownAt.current }, locale).catch(
      () => null,
    );
    if (result?.ok) {
      router.replace(next);
      router.refresh();
    } else if (result?.error === "invalid") {
      for (const [name, messages] of Object.entries(result.fieldErrors)) {
        form.setError(name as FieldName, { message: messages[0] });
      }
    } else if (result?.error === "emailTaken") {
      form.setError("email", { message: t("errors.emailTaken") });
    } else {
      const key = result?.error === "tooManyAttempts" || result?.error === "rejected" ? result.error : "failed";
      setFormError(t(`errors.${key}`));
    }
  }

  const text = (name: FieldName, type: string, autoComplete: string) => (
    <Controller
      name={name}
      control={form.control}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid}>
          <FieldLabel htmlFor={name}>{t(name)}</FieldLabel>
          <Input {...field} id={name} type={type} autoComplete={autoComplete} aria-invalid={fieldState.invalid} />
          <FieldError errors={[fieldState.error]} />
        </Field>
      )}
    />
  );

  return (
    <form onSubmit={(event) => void form.handleSubmit(onSubmit)(event)} method="post" noValidate className="relative">
      <FieldGroup>
        {text("name", "text", "name")}
        {text("email", "email", "email")}
        {text("password", "password", "new-password")}
        {text("confirmPassword", "password", "new-password")}
        <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
          <label>
            Website
            <input
              name="website"
              tabIndex={-1}
              autoComplete="off"
              value={honeypot}
              onChange={(event) => setHoneypot(event.target.value)}
            />
          </label>
        </div>
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
