"use client";

import { useEffect, useMemo, useState } from "react";
import { Controller, useForm, type Path } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Link, useRouter } from "@/i18n/navigation";
import { PageContent } from "@/components/page-content";
import { Button, buttonVariants } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { slugify } from "@/lib/slug";
import { PAGE_CONTENT_MAX } from "@/lib/store-pages";
import { useHydrated } from "@/lib/use-hydrated";
import { createStorePageSchema, type StorePageValues } from "@/lib/validation/store-page";
import { createStorePageAction, updateStorePageAction } from "@/server/store-page-actions";

/** Create / edit a custom store page (edit mode when `pageId` is given). */
export function PageForm({ pageId, initialValues }: { pageId?: string; initialValues: StorePageValues }) {
  const t = useTranslations("Settings.pages");
  const tv = useTranslations("Validation");
  const locale = useLocale();
  const router = useRouter();
  const hydrated = useHydrated();
  const [formError, setFormError] = useState<string | null>(null);

  const schema = useMemo(() => createStorePageSchema(tv), [tv]);
  const form = useForm<StorePageValues>({ resolver: zodResolver(schema), defaultValues: initialValues });

  // New pages: the URL follows the title until the merchant edits it
  const title = form.watch("title");
  const slug = form.watch("slug");
  const slugDirty = form.formState.dirtyFields.slug;
  useEffect(() => {
    if (!pageId && !slugDirty) form.setValue("slug", slugify(title));
  }, [title, slugDirty, pageId, form]);

  async function onSubmit(values: StorePageValues) {
    setFormError(null);
    const result = pageId ? await updateStorePageAction(pageId, values, locale) : await createStorePageAction(values, locale);
    if (result.ok) {
      toast.success(t(pageId ? "toasts.saved" : "toasts.created", { title: values.title.trim() }));
      router.push("/dashboard/settings/pages");
      router.refresh();
      return;
    }
    switch (result.error) {
      case "invalid":
        for (const [field, messages] of Object.entries(result.fieldErrors ?? {})) {
          form.setError(field as Path<StorePageValues>, { message: messages[0] });
        }
        return;
      case "slugTaken":
        form.setError("slug", { message: tv("pageSlugTaken") });
        return;
      default:
        setFormError(t(`errors.${result.error}`));
    }
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} method="post" noValidate>
      <FieldGroup>
        <Controller
          name="title"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor={field.name}>{t("pageTitle")}</FieldLabel>
              <Input {...field} id={field.name} placeholder={t("pageTitlePlaceholder")} aria-invalid={fieldState.invalid} />
              <FieldError errors={[fieldState.error]} />
            </Field>
          )}
        />

        <Controller
          name="slug"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor={field.name}>{t("slug")}</FieldLabel>
              <Input
                {...field}
                id={field.name}
                autoCapitalize="none"
                autoComplete="off"
                spellCheck={false}
                placeholder={t("slugPlaceholder")}
                aria-invalid={fieldState.invalid}
              />
              <FieldDescription>{t("slugHelp", { path: `/${slug || "..."}` })}</FieldDescription>
              <FieldError errors={[fieldState.error]} />
            </Field>
          )}
        />

        <Controller
          name="content"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor={field.name}>{t("content")}</FieldLabel>
              <Tabs defaultValue="write" className="gap-3">
                <TabsList aria-label={t("contentTabs")}>
                  <TabsTrigger value="write">{t("write")}</TabsTrigger>
                  <TabsTrigger value="preview">{t("preview")}</TabsTrigger>
                </TabsList>
                <TabsContent value="write" className="flex flex-col gap-2">
                  <Textarea
                    {...field}
                    id={field.name}
                    rows={14}
                    className="font-mono text-sm"
                    placeholder={t("contentPlaceholder")}
                    aria-invalid={fieldState.invalid}
                  />
                  <FieldDescription>
                    {t("contentCount", { count: field.value.length, max: PAGE_CONTENT_MAX })}
                  </FieldDescription>
                  <FormatHelp />
                </TabsContent>
                <TabsContent value="preview">
                  <div className="min-h-40 rounded-lg border p-4">
                    {field.value.trim() === "" ? (
                      <p className="text-sm text-muted-foreground">{t("previewEmpty")}</p>
                    ) : (
                      <PageContent content={field.value} preview />
                    )}
                  </div>
                </TabsContent>
              </Tabs>
              <FieldError errors={[fieldState.error]} />
            </Field>
          )}
        />

        <Controller
          name="status"
          control={form.control}
          render={({ field }) => (
            <Field orientation="horizontal" className="w-auto">
              <Switch
                id={field.name}
                checked={field.value === "published"}
                onCheckedChange={(checked) => field.onChange(checked ? "published" : "draft")}
              />
              <div className="flex flex-col gap-0.5">
                <FieldLabel htmlFor={field.name}>{t("published")}</FieldLabel>
                <FieldDescription>{t("publishedHelp")}</FieldDescription>
              </div>
            </Field>
          )}
        />

        {/* ---- search engines */}
        <section className="flex flex-col gap-4" aria-labelledby="page-seo-title">
          <div>
            <h2 id="page-seo-title" className="text-base font-semibold">
              {t("seoTitle")}
            </h2>
            <p className="text-sm text-muted-foreground">{t("seoHelp")}</p>
          </div>
          <Controller
            name="metaTitle"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor={field.name}>{t("metaTitle")}</FieldLabel>
                <Input {...field} id={field.name} placeholder={t("metaTitlePlaceholder")} aria-invalid={fieldState.invalid} />
                <FieldDescription>{t("metaTitleHelp", { count: field.value.length })}</FieldDescription>
                <FieldError errors={[fieldState.error]} />
              </Field>
            )}
          />
          <Controller
            name="metaDescription"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor={field.name}>{t("metaDescription")}</FieldLabel>
                <Textarea
                  {...field}
                  id={field.name}
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
          <Button type="submit" disabled={!hydrated || form.formState.isSubmitting}>
            {form.formState.isSubmitting ? t("saving") : t("save")}
          </Button>
          <Link href="/dashboard/settings/pages" className={buttonVariants({ variant: "outline" })}>
            {t("cancel")}
          </Link>
        </div>
      </FieldGroup>
    </form>
  );
}

/** The few marks the content understands, each with what it looks like. */
function FormatHelp() {
  const t = useTranslations("Settings.pages.format");
  const rows = [
    { mark: "# ", key: "heading" },
    { mark: "## ", key: "subheading" },
    { mark: "### ", key: "minorHeading" },
    { mark: "---", key: "divider" },
    { mark: "- ", key: "bullet" },
    { mark: "1. ", key: "numbered" },
    { mark: "**…**", key: "bold" },
    { mark: "[…](…)", key: "link" },
  ] as const;

  return (
    <details className="rounded-md bg-muted/50 p-3 text-sm">
      <summary className="cursor-pointer font-medium">{t("title")}</summary>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
        {rows.map(({ mark, key }) => (
          <div key={key} className="contents">
            <dt>
              <code className="rounded bg-background px-1.5 py-0.5 font-mono text-xs">{mark}</code>
            </dt>
            <dd className="text-muted-foreground">{t(key)}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-muted-foreground">{t("paragraphs")}</p>
    </details>
  );
}
