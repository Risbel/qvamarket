"use client";

import { useEffect, useMemo, useState } from "react";
import { Controller, useForm, type Control } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { generateTemporaryPassword } from "@/lib/passwords";
import { useHydrated } from "@/lib/use-hydrated";
import { slugify } from "@/lib/slug";
import {
  createMerchantSchema,
  type MerchantValues,
} from "@/lib/validation/merchant";
import {
  createMerchantAction,
  type CreateMerchantActionResult,
} from "@/server/merchant-actions";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type Created = Extract<CreateMerchantActionResult, { ok: true }>;

export function MerchantForm() {
  const t = useTranslations("Admin");
  const tv = useTranslations("Validation");
  const locale = useLocale();
  const hydrated = useHydrated();
  const [created, setCreated] = useState<Created | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const schema = useMemo(() => createMerchantSchema(tv), [tv]);
  const form = useForm<MerchantValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      companyName: "",
      storeName: "",
      storeSlug: "",
      userName: "",
      userEmail: "",
      temporaryPassword: "",
    },
  });

  // Suggest a password once, on the client only (avoids SSR/hydration mismatch)
  useEffect(() => {
    form.setValue("temporaryPassword", generateTemporaryPassword());
  }, [form]);

  // Suggest the subdomain from the store name until the superadmin edits it
  const storeName = form.watch("storeName");
  const slugDirty = form.formState.dirtyFields.storeSlug;
  useEffect(() => {
    if (!slugDirty) form.setValue("storeSlug", slugify(storeName));
  }, [storeName, slugDirty, form]);

  async function onSubmit(values: MerchantValues) {
    setFormError(null);
    const result = await createMerchantAction(values, locale);

    if (result.ok) {
      setCreated(result);
      return;
    }
    if (result.error === "invalid") {
      for (const [name, messages] of Object.entries(result.fieldErrors ?? {})) {
        form.setError(name as keyof MerchantValues, { message: messages[0] });
      }
    } else if (result.error === "slugTaken") {
      form.setError("storeSlug", { message: tv("slugTaken") });
    } else if (result.error === "emailTaken") {
      form.setError("userEmail", { message: tv("emailTaken") });
    } else {
      setFormError(t(`errors.${result.error}`));
    }
  }

  if (created) {
    return <CreatedCard created={created} onAnother={() => location.reload()} />;
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} method="post" noValidate>
      <FieldGroup>
        <TextField control={form.control} name="companyName" label={t("form.companyName")} />
        <TextField control={form.control} name="storeName" label={t("form.storeName")} />
        <TextField
          control={form.control}
          name="storeSlug"
          label={t("form.storeSlug")}
          description={t("form.storeSlugHelp")}
          autoCapitalize="none"
        />
        <TextField control={form.control} name="userName" label={t("form.userName")} />
        <TextField
          control={form.control}
          name="userEmail"
          label={t("form.userEmail")}
          type="email"
          autoComplete="off"
        />

        <Controller
          name="temporaryPassword"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor="temporaryPassword">
                {t("form.temporaryPassword")}
              </FieldLabel>
              <div className="flex gap-2">
                <Input
                  {...field}
                  id="temporaryPassword"
                  autoComplete="off"
                  aria-invalid={fieldState.invalid}
                  className="font-mono"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    form.setValue("temporaryPassword", generateTemporaryPassword(), {
                      shouldValidate: true,
                    })
                  }
                >
                  {t("form.generate")}
                </Button>
              </div>
              <FieldDescription>{t("form.temporaryPasswordHelp")}</FieldDescription>
              <FieldError errors={[fieldState.error]} />
            </Field>
          )}
        />

        {formError && <FieldError>{formError}</FieldError>}

        <div className="flex gap-2">
          <Button type="submit" disabled={!hydrated || form.formState.isSubmitting}>
            {form.formState.isSubmitting ? t("form.creating") : t("form.create")}
          </Button>
          <Link href="/admin" className={buttonVariants({ variant: "outline" })}>
            {t("form.cancel")}
          </Link>
        </div>
      </FieldGroup>
    </form>
  );
}

function TextField({
  control,
  name,
  label,
  description,
  ...inputProps
}: {
  control: Control<MerchantValues>;
  name: Exclude<keyof MerchantValues, "temporaryPassword">;
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
          <Input
            {...inputProps}
            {...field}
            id={name}
            aria-invalid={fieldState.invalid}
          />
          {description && <FieldDescription>{description}</FieldDescription>}
          <FieldError errors={[fieldState.error]} />
        </Field>
      )}
    />
  );
}

function CreatedCard({
  created,
  onAnother,
}: {
  created: Created;
  onAnother: () => void;
}) {
  const t = useTranslations("Admin");
  const [copied, setCopied] = useState(false);

  const credentials = `${t("created.store")}: ${created.storeUrl}\n${t("created.email")}: ${created.userEmail}\n${t("created.password")}: ${created.temporaryPassword}`;

  async function copy() {
    await navigator.clipboard.writeText(credentials);
    setCopied(true);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("created.title", { store: created.storeName })}</CardTitle>
        <CardDescription>{t("created.warning")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <pre className="rounded-md bg-muted p-3 font-mono text-sm whitespace-pre-wrap break-all">
          {credentials}
        </pre>
        <div className="flex flex-wrap gap-2">
          <Button onClick={copy}>{copied ? t("created.copied") : t("created.copy")}</Button>
          <Button variant="outline" onClick={onAnother}>
            {t("created.another")}
          </Button>
          <Link href="/admin" className={buttonVariants({ variant: "outline" })}>
            {t("created.back")}
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
