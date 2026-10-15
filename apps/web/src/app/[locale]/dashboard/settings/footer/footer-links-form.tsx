"use client";

import { useMemo, useState } from "react";
import { Controller, useFieldArray, useForm, useFormState, type Control, type FieldPath } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowDown, ArrowUp, PlusIcon, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { MAX_FOOTER_GROUPS, MAX_FOOTER_LINKS, normalizeLinkUrl } from "@/lib/footer";
import { useHydrated } from "@/lib/use-hydrated";
import { createFooterLinksSchema, type FooterLinksValues } from "@/lib/validation/footer";
import { updateFooterLinksAction } from "@/server/catalog-actions";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

type FormControl = Control<FooterLinksValues>;

const emptyLink = () => ({ label: "", url: "", newTab: false });

/**
 * Footer link groups (e.g. "Accesos": Preguntas frecuentes, Contacto...). Groups and links are
 * two nested field arrays; their order on screen is the order saved and shown on the store.
 */
export function FooterLinksForm({ initialValues }: { initialValues: FooterLinksValues }) {
  const t = useTranslations("Settings.footer");
  const tv = useTranslations("Validation");
  const locale = useLocale();
  const router = useRouter();
  const hydrated = useHydrated();
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const schema = useMemo(() => createFooterLinksSchema(tv), [tv]);
  const form = useForm<FooterLinksValues>({ resolver: zodResolver(schema), defaultValues: initialValues });
  const groups = useFieldArray({ control: form.control, name: "groups" });

  async function onSubmit(values: FooterLinksValues) {
    setStatus(null);
    const result = await updateFooterLinksAction(values, locale);
    if (result.ok) {
      setStatus({ ok: true, text: t("saved") });
      router.refresh();
    } else if (result.error === "invalid") {
      for (const [path, messages] of Object.entries(result.fieldErrors ?? {})) {
        form.setError(path as FieldPath<FooterLinksValues>, { message: messages[0] });
      }
      setStatus({ ok: false, text: t("errors.invalid") });
    } else {
      setStatus({ ok: false, text: t(`errors.${result.error === "forbidden" ? "forbidden" : "failed"}`) });
    }
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} method="post" noValidate className="flex flex-col gap-6">
      {groups.fields.length === 0 && <p className="text-sm text-muted-foreground">{t("empty")}</p>}

      {groups.fields.map((group, index) => (
        <fieldset key={group.id} className="flex flex-col gap-4 rounded-lg border p-4">
          <div className="flex items-center gap-2">
            <legend className="text-sm font-medium">{t("group", { number: index + 1 })}</legend>
            <div className="ml-auto flex gap-1">
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                disabled={index === 0}
                onClick={() => groups.move(index, index - 1)}
                aria-label={t("groupMoveUp", { number: index + 1 })}
              >
                <ArrowUp aria-hidden />
              </Button>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                disabled={index === groups.fields.length - 1}
                onClick={() => groups.move(index, index + 1)}
                aria-label={t("groupMoveDown", { number: index + 1 })}
              >
                <ArrowDown aria-hidden />
              </Button>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                onClick={() => groups.remove(index)}
                aria-label={t("groupRemove", { number: index + 1 })}
              >
                <Trash2 aria-hidden />
              </Button>
            </div>
          </div>

          <Controller
            name={`groups.${index}.title`}
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor={field.name}>{t("groupTitle")}</FieldLabel>
                <Input {...field} id={field.name} placeholder={t("groupTitlePlaceholder")} aria-invalid={fieldState.invalid} />
                <FieldError errors={[fieldState.error]} />
              </Field>
            )}
          />

          <GroupLinks control={form.control} groupIndex={index} />
        </fieldset>
      ))}

      {groups.fields.length < MAX_FOOTER_GROUPS && (
        <Button
          type="button"
          variant="outline"
          className="w-fit"
          onClick={() => groups.append({ title: "", links: [emptyLink()] })}
        >
          <PlusIcon aria-hidden />
          {t("groupAdd")}
        </Button>
      )}

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
    </form>
  );
}

/** The links of one group: a nested field array under groups.<index>.links. */
function GroupLinks({ control, groupIndex }: { control: FormControl; groupIndex: number }) {
  const t = useTranslations("Settings.footer");
  const links = useFieldArray({ control, name: `groups.${groupIndex}.links` });

  return (
    <div className="flex flex-col gap-3">
      <span className="text-sm font-medium">{t("links")}</span>
      <ol className="flex flex-col gap-3">
        {links.fields.map((link, index) => {
          const base = `groups.${groupIndex}.links.${index}` as const;
          return (
            <li key={link.id} className="flex flex-col gap-3 rounded-md bg-muted/50 p-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Controller
                  name={`${base}.label`}
                  control={control}
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel htmlFor={field.name}>{t("linkLabel")}</FieldLabel>
                      <Input {...field} id={field.name} placeholder={t("linkLabelPlaceholder")} aria-invalid={fieldState.invalid} />
                      <FieldError errors={[fieldState.error]} />
                    </Field>
                  )}
                />
                <Controller
                  name={`${base}.url`}
                  control={control}
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel htmlFor={field.name}>{t("linkUrl")}</FieldLabel>
                      <Input
                        {...field}
                        id={field.name}
                        inputMode="url"
                        autoComplete="off"
                        spellCheck={false}
                        placeholder="https://"
                        aria-invalid={fieldState.invalid}
                        // "tienda.com" becomes "https://tienda.com" when leaving the field
                        onBlur={() => {
                          field.onChange(normalizeLinkUrl(field.value));
                          field.onBlur();
                        }}
                      />
                      <FieldError errors={[fieldState.error]} />
                    </Field>
                  )}
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Controller
                  name={`${base}.newTab`}
                  control={control}
                  render={({ field }) => (
                    <Field orientation="horizontal" className="w-auto">
                      <Switch
                        id={field.name}
                        size="sm"
                        checked={field.value}
                        onCheckedChange={(checked) => field.onChange(checked)}
                      />
                      <FieldLabel htmlFor={field.name} className="font-normal">
                        {t("linkNewTab")}
                      </FieldLabel>
                    </Field>
                  )}
                />
                <div className="ml-auto flex gap-1">
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    disabled={index === 0}
                    onClick={() => links.move(index, index - 1)}
                    aria-label={t("linkMoveUp", { number: index + 1 })}
                  >
                    <ArrowUp aria-hidden />
                  </Button>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    disabled={index === links.fields.length - 1}
                    onClick={() => links.move(index, index + 1)}
                    aria-label={t("linkMoveDown", { number: index + 1 })}
                  >
                    <ArrowDown aria-hidden />
                  </Button>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    onClick={() => links.remove(index)}
                    aria-label={t("linkRemove", { number: index + 1 })}
                  >
                    <Trash2 aria-hidden />
                  </Button>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
      <LinksError control={control} groupIndex={groupIndex} />
      {links.fields.length < MAX_FOOTER_LINKS && (
        <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => links.append(emptyLink())}>
          <PlusIcon aria-hidden />
          {t("linkAdd")}
        </Button>
      )}
      <FieldDescription>{t("linkUrlHelp")}</FieldDescription>
    </div>
  );
}

/** Error of the list itself (e.g. a group left without links). */
function LinksError({ control, groupIndex }: { control: FormControl; groupIndex: number }) {
  const { errors } = useFormState({ control, name: `groups.${groupIndex}.links` });
  const error = errors.groups?.[groupIndex]?.links;
  return <FieldError errors={[error?.root ?? (error?.message ? { message: error.message } : undefined)]} />;
}
