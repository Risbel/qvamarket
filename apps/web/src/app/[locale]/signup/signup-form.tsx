"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Controller, useForm, type Control } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { slugify } from "@/lib/slug";
import { MIN_PASSWORD_LENGTH } from "@/lib/validation/auth";
import { useHydrated } from "@/lib/use-hydrated";
import { createSignupSchema, type SignupValues } from "@/lib/validation/signup";
import { signupAction } from "@/server/signup-actions";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/password-input";

export function SignupForm() {
  const t = useTranslations("Signup");
  const tv = useTranslations("Validation");
  const locale = useLocale();
  const router = useRouter();
  const hydrated = useHydrated();
  const [formError, setFormError] = useState<string | null>(null);

  // Anti-bot: a hidden field humans never fill, and how long the form has been open
  const [honeypot, setHoneypot] = useState("");
  const shownAt = useRef(0);
  useEffect(() => {
    shownAt.current = Date.now();
  }, []);

  const schema = useMemo(() => createSignupSchema(tv), [tv]);
  const form = useForm<SignupValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      userName: "",
      userEmail: "",
      password: "",
      confirmPassword: "",
      companyName: "",
      storeName: "",
      storeSlug: "",
    },
  });

  // Suggest the subdomain from the store name until the merchant edits it
  const storeName = form.watch("storeName");
  const storeSlug = form.watch("storeSlug");
  const slugDirty = form.formState.dirtyFields.storeSlug;
  useEffect(() => {
    if (!slugDirty) form.setValue("storeSlug", slugify(storeName));
  }, [storeName, slugDirty, form]);

  async function onSubmit(values: SignupValues) {
    setFormError(null);
    const result = await signupAction(
      values,
      { honeypot, elapsedMs: Date.now() - shownAt.current },
      locale,
    );

    if (result.ok) {
      router.push("/dashboard");
      router.refresh();
      return;
    }
    if (result.error === "invalid") {
      for (const [name, messages] of Object.entries(result.fieldErrors)) {
        form.setError(name as keyof SignupValues, { message: messages[0] });
      }
    } else if (result.error === "slugTaken") {
      form.setError("storeSlug", { message: tv("slugTaken") });
    } else if (result.error === "emailTaken") {
      form.setError("userEmail", { message: tv("emailTaken") });
    } else {
      setFormError(t(`errors.${result.error}`));
    }
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} method="post" noValidate>
      <FieldGroup>
        <TextField
          control={form.control}
          name="userName"
          label={t("userName")}
          placeholder={t("userNamePlaceholder")}
          autoComplete="name"
        />
        <TextField
          control={form.control}
          name="userEmail"
          label={t("userEmail")}
          placeholder={t("userEmailPlaceholder")}
          type="email"
          autoComplete="email"
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            control={form.control}
            name="password"
            label={t("password")}
            description={t("passwordHelp", { min: MIN_PASSWORD_LENGTH })}
            type="password"
            autoComplete="new-password"
          />
          <TextField
            control={form.control}
            name="confirmPassword"
            label={t("confirmPassword")}
            type="password"
            autoComplete="new-password"
          />
        </div>
        <TextField
          control={form.control}
          name="companyName"
          label={t("companyName")}
          placeholder={t("companyNamePlaceholder")}
          autoComplete="organization"
        />
        <TextField
          control={form.control}
          name="storeName"
          label={t("storeName")}
          placeholder={t("storeNamePlaceholder")}
          autoComplete="off"
        />
        <TextField
          control={form.control}
          name="storeSlug"
          label={t("storeSlug")}
          placeholder={t("storeSlugPlaceholder")}
          description={t("storeSlugHelp", { url: `${storeSlug || "mitienda"}.qvashop.com` })}
          autoComplete="off"
          autoCapitalize="none"
        />

        {/* Honeypot: invisible to people and to screen readers; bots tend to fill every field */}
        <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
          <label>
            Website
            <input
              type="text"
              name="website"
              tabIndex={-1}
              autoComplete="off"
              value={honeypot}
              onChange={(event) => setHoneypot(event.target.value)}
            />
          </label>
        </div>

        <p className="text-sm text-muted-foreground">{t("approvalNotice")}</p>

        {formError && <FieldError>{formError}</FieldError>}
        <Button type="submit" disabled={!hydrated || form.formState.isSubmitting}>
          {form.formState.isSubmitting ? t("submitting") : t("submit")}
        </Button>
      </FieldGroup>
    </form>
  );
}

function TextField({
  control,
  name,
  label,
  description,
  type,
  ...inputProps
}: {
  control: Control<SignupValues>;
  name: keyof SignupValues;
  label: string;
  description?: string;
} & Omit<React.ComponentProps<typeof Input>, "name">) {
  return (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid}>
          <FieldLabel htmlFor={name}>{label}</FieldLabel>
          {type === "password" ? (
            <PasswordInput {...inputProps} {...field} id={name} aria-invalid={fieldState.invalid} />
          ) : (
            <Input {...inputProps} {...field} id={name} type={type} aria-invalid={fieldState.invalid} />
          )}
          {description && <FieldDescription>{description}</FieldDescription>}
          <FieldError errors={[fieldState.error]} />
        </Field>
      )}
    />
  );
}
