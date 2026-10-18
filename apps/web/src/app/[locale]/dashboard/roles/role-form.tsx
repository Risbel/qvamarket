"use client";

import { useMemo, useState } from "react";
import { Controller, useForm, type Path } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Link, useRouter } from "@/i18n/navigation";
import { PermissionFieldset } from "@/components/permissions/permission-fieldset";
import { usePermission } from "@/components/permissions/permissions-provider";
import { Button, buttonVariants } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { MAX_COMPANY_ROLES } from "@/lib/roles";
import { useHydrated } from "@/lib/use-hydrated";
import { createRoleSchema, type RoleValues } from "@/lib/validation/role";
import { createRoleAction, updateRoleAction } from "@/server/role-actions";
import { PermissionMatrix, type PermissionValue } from "./permission-matrix";

export type RoleTemplate = { key: string; name: string; description: string; permissions: PermissionValue };

const FROM_SCRATCH = "_none";

/**
 * Create / edit a company role (edit mode when `roleId` is given). New roles can start from a
 * template (the presets): it fills the permissions, and the name and description while empty.
 * `lockedReason`: shown read-only for that reason (e.g. the role grants more than the editor).
 */
export function RoleForm({
  roleId,
  initialValues,
  templates = [],
  lockedReason,
}: {
  roleId?: string;
  initialValues: RoleValues;
  templates?: RoleTemplate[];
  lockedReason?: string;
}) {
  const t = useTranslations("Roles");
  const tv = useTranslations("Validation");
  const locale = useLocale();
  const router = useRouter();
  const hydrated = useHydrated();
  const [formError, setFormError] = useState<string | null>(null);
  const [template, setTemplate] = useState(FROM_SCRATCH);

  const schema = useMemo(() => createRoleSchema(tv), [tv]);
  const form = useForm<RoleValues>({ resolver: zodResolver(schema), defaultValues: initialValues });
  const permission = roleId ? { role: ["update"] as const } : { role: ["create"] as const };
  // Base UI's checkbox and select are not native controls: the fieldset does not disable them
  const editable = usePermission(permission) && !lockedReason;
  const templateNames = new Map(templates.map((tpl) => [tpl.key, tpl.name]));

  function applyTemplate(key: string) {
    setTemplate(key);
    const picked = templates.find((tpl) => tpl.key === key);
    if (!picked) return;
    form.setValue("permissions", picked.permissions, { shouldDirty: true, shouldValidate: form.formState.isSubmitted });
    if (form.getValues("name").trim() === "") form.setValue("name", picked.name, { shouldDirty: true });
    if (form.getValues("description").trim() === "") form.setValue("description", picked.description, { shouldDirty: true });
  }

  async function onSubmit(values: RoleValues) {
    setFormError(null);
    const result = roleId ? await updateRoleAction(roleId, values, locale) : await createRoleAction(values, locale);
    if (result.ok) {
      toast.success(t(roleId ? "toasts.saved" : "toasts.created", { name: values.name.trim() }));
      router.push("/dashboard/roles");
      router.refresh();
      return;
    }
    switch (result.error) {
      case "invalid":
        for (const [field, messages] of Object.entries(result.fieldErrors ?? {})) {
          form.setError(field as Path<RoleValues>, { message: messages[0] });
        }
        return;
      case "nameTaken":
        form.setError("name", { message: tv("roleNameTaken") });
        return;
      case "empty":
        form.setError("permissions", { message: tv("rolePermissionsRequired") });
        return;
      case "limit":
        setFormError(t("errors.limit", { max: MAX_COMPANY_ROLES }));
        return;
      case "forbidden":
      case "notFound":
      case "escalation":
        setFormError(t(`errors.${result.error}`));
        return;
      default:
        setFormError(t("errors.failed"));
    }
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} method="post" noValidate className="flex flex-col gap-4">
      <PermissionFieldset permission={permission} lockedReason={lockedReason}>
        <FieldGroup>
          {!roleId && templates.length > 0 && (
            <Field>
              <FieldLabel htmlFor="template">{t("form.template")}</FieldLabel>
              <Select value={template} disabled={!editable} onValueChange={(value) => typeof value === "string" && applyTemplate(value)}>
                <SelectTrigger id="template" className="w-full">
                  <SelectValue>
                    {(value: string) => templateNames.get(value) ?? t("form.templateNone")}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={FROM_SCRATCH}>{t("form.templateNone")}</SelectItem>
                  {templates.map((tpl) => (
                    <SelectItem key={tpl.key} value={tpl.key}>
                      {tpl.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldDescription>{t("form.templateHelp")}</FieldDescription>
            </Field>
          )}

          <Controller
            name="name"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor={field.name}>{t("form.name")}</FieldLabel>
                <Input {...field} id={field.name} placeholder={t("form.namePlaceholder")} aria-invalid={fieldState.invalid} />
                <FieldError errors={[fieldState.error]} />
              </Field>
            )}
          />

          <Controller
            name="description"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor={field.name}>{t("form.description")}</FieldLabel>
                <Textarea
                  {...field}
                  id={field.name}
                  rows={2}
                  placeholder={t("form.descriptionPlaceholder")}
                  aria-invalid={fieldState.invalid}
                />
                <FieldError errors={[fieldState.error]} />
              </Field>
            )}
          />

          <Controller
            name="permissions"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel id="permissions-label">{t("form.permissions")}</FieldLabel>
                <FieldDescription id="permissions-help">{t("form.permissionsHelp")}</FieldDescription>
                <PermissionMatrix
                  value={field.value}
                  onChange={field.onChange}
                  disabled={!hydrated || !editable}
                  invalid={fieldState.invalid}
                  describedBy="permissions-help"
                />
                <FieldError errors={[fieldState.error]} />
              </Field>
            )}
          />

          {formError && <FieldError>{formError}</FieldError>}

          <div className="flex gap-2">
            <Button type="submit" disabled={!hydrated || form.formState.isSubmitting}>
              {form.formState.isSubmitting ? t("form.saving") : t("form.save")}
            </Button>
            <Link href="/dashboard/roles" className={buttonVariants({ variant: "outline" })}>
              {t("cancel")}
            </Link>
          </div>
        </FieldGroup>
      </PermissionFieldset>
    </form>
  );
}
