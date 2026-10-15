"use client";

import { useMemo, useState } from "react";
import { Controller, useFieldArray, useForm, useWatch, type FieldPath } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowDown, ArrowUp, PlusIcon, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { useRouter } from "@/i18n/navigation";
import { normalizeLinkUrl } from "@/lib/footer";
import { isSocialNetwork, SOCIAL_NETWORKS, socialNetwork } from "@/lib/social";
import { useHydrated } from "@/lib/use-hydrated";
import { createFooterSocialSchema, type FooterSocialValues } from "@/lib/validation/footer";
import { updateFooterSocialAction } from "@/server/catalog-actions";
import { SocialIcon } from "@/components/social-icon";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/**
 * Social media icons of the storefront footer: one row per network (a network at most once),
 * in the order shown on the store. Every icon opens its page in a new tab.
 */
export function FooterSocialForm({ initialValues }: { initialValues: FooterSocialValues }) {
  const t = useTranslations("Settings.footer.social");
  const tv = useTranslations("Validation");
  const locale = useLocale();
  const router = useRouter();
  const hydrated = useHydrated();
  const [formError, setFormError] = useState<string | null>(null);
  const schema = useMemo(() => createFooterSocialSchema(tv), [tv]);
  const form = useForm<FooterSocialValues>({ resolver: zodResolver(schema), defaultValues: initialValues });
  const links = useFieldArray({ control: form.control, name: "links" });
  const chosen = useWatch({ control: form.control, name: "links" });
  const used = new Set(chosen.map((link) => link.network));
  const nextFree = SOCIAL_NETWORKS.find((network) => !used.has(network.key));

  async function onSubmit(values: FooterSocialValues) {
    setFormError(null);
    const result = await updateFooterSocialAction(values, locale);
    if (result.ok) {
      toast.success(t("saved"));
      router.refresh();
    } else if (result.error === "invalid") {
      for (const [path, messages] of Object.entries(result.fieldErrors ?? {})) {
        form.setError(path as FieldPath<FooterSocialValues>, { message: messages[0] });
      }
      setFormError(t("errors.invalid"));
    } else {
      setFormError(t(`errors.${result.error === "forbidden" ? "forbidden" : "failed"}`));
    }
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} method="post" noValidate className="flex flex-col gap-6">
      {links.fields.length === 0 && <p className="text-sm text-muted-foreground">{t("empty")}</p>}

      <ol className="flex flex-col gap-3">
        {links.fields.map((link, index) => {
          const network = socialNetwork(chosen[index]?.network ?? link.network);
          return (
            <li key={link.id} className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-start">
              <Controller
                name={`links.${index}.network`}
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid} className="sm:w-48 sm:shrink-0">
                    <FieldLabel htmlFor={field.name}>{t("network")}</FieldLabel>
                    <Select
                      value={field.value}
                      onValueChange={(next) => {
                        if (isSocialNetwork(next)) field.onChange(next);
                      }}
                    >
                      <SelectTrigger id={field.name} aria-invalid={fieldState.invalid || undefined} className="w-full">
                        <SelectValue>
                          {(value: string | null) =>
                            isSocialNetwork(value) && (
                              <span className="flex items-center gap-2">
                                <SocialIcon network={value} className="size-4" />
                                {socialNetwork(value).name}
                              </span>
                            )
                          }
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent alignItemWithTrigger={false} align="start">
                        {SOCIAL_NETWORKS.map((option) => (
                          <SelectItem
                            key={option.key}
                            value={option.key}
                            disabled={option.key !== field.value && used.has(option.key)}
                          >
                            <SocialIcon network={option.key} className="size-4 self-center" />
                            {option.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FieldError errors={[fieldState.error]} />
                  </Field>
                )}
              />
              <Controller
                name={`links.${index}.url`}
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid} className="min-w-0 flex-1">
                    <FieldLabel htmlFor={field.name}>{t("url")}</FieldLabel>
                    <Input
                      {...field}
                      id={field.name}
                      inputMode="url"
                      autoComplete="off"
                      spellCheck={false}
                      placeholder={network.placeholder}
                      aria-invalid={fieldState.invalid}
                      // "instagram.com/x" becomes "https://instagram.com/x" when leaving the field
                      onBlur={() => {
                        field.onChange(normalizeLinkUrl(field.value));
                        field.onBlur();
                      }}
                    />
                    <FieldError errors={[fieldState.error]} />
                  </Field>
                )}
              />
              <div className="flex gap-1 self-end sm:mt-6 sm:self-start">
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  disabled={index === 0}
                  onClick={() => links.move(index, index - 1)}
                  aria-label={t("moveUp", { name: network.name })}
                >
                  <ArrowUp aria-hidden />
                </Button>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  disabled={index === links.fields.length - 1}
                  onClick={() => links.move(index, index + 1)}
                  aria-label={t("moveDown", { name: network.name })}
                >
                  <ArrowDown aria-hidden />
                </Button>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => links.remove(index)}
                  aria-label={t("remove", { name: network.name })}
                >
                  <Trash2 aria-hidden />
                </Button>
              </div>
            </li>
          );
        })}
      </ol>

      <div className="flex flex-col gap-2">
        {nextFree && (
          <Button
            type="button"
            variant="outline"
            className="w-fit"
            onClick={() => links.append({ network: nextFree.key, url: "" })}
          >
            <PlusIcon aria-hidden />
            {t("add")}
          </Button>
        )}
        <FieldDescription>{t("help")}</FieldDescription>
      </div>

      {formError && (
        <p role="alert" className="text-sm text-destructive">
          {formError}
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
