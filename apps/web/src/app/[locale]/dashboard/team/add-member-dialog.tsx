"use client";

import { useMemo, useState } from "react";
import { Controller, useForm, useWatch, type Path } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { UserPlusIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { useRouter } from "@/i18n/navigation";
import { useHydrated } from "@/lib/use-hydrated";
import { createTeamMemberSchema, type TeamMemberValues } from "@/lib/validation/team";
import { addTeamMemberAction } from "@/server/team-actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { CredentialsPanel } from "./credentials-panel";
import { RoleSelect, roleDescription, type RoleOption } from "./role-select";

/**
 * Adds a team member: name, email and role. The server creates the account with a temporary
 * password, shown here once (the member must change it on first sign-in).
 */
export function AddMemberDialog({ roles }: { roles: RoleOption[] }) {
  const t = useTranslations("Team");
  const tv = useTranslations("Validation");
  const locale = useLocale();
  const router = useRouter();
  const hydrated = useHydrated();
  const [open, setOpen] = useState(false);
  const [created, setCreated] = useState<{ email: string; temporaryPassword: string } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const schema = useMemo(() => createTeamMemberSchema(tv), [tv]);
  const defaultValues: TeamMemberValues = { name: "", email: "", roleKey: roles[0]?.key ?? "" };
  const form = useForm<TeamMemberValues>({ resolver: zodResolver(schema), defaultValues });
  const roleKey = useWatch({ control: form.control, name: "roleKey" });

  function onOpenChange(next: boolean) {
    if (form.formState.isSubmitting) return;
    setOpen(next);
    if (!next) {
      // Forget the credentials as soon as the dialog closes
      setCreated(null);
      setFormError(null);
      form.reset(defaultValues);
    }
  }

  async function onSubmit(values: TeamMemberValues) {
    setFormError(null);
    const result = await addTeamMemberAction(values, locale).catch(() => null);
    if (result?.ok) {
      setCreated({ email: result.email, temporaryPassword: result.temporaryPassword });
      toast.success(t("toasts.added", { name: values.name.trim() }));
      router.refresh();
      return;
    }
    switch (result?.error) {
      case "invalid":
        for (const [field, messages] of Object.entries(result.fieldErrors ?? {})) {
          form.setError(field as Path<TeamMemberValues>, { message: messages[0] });
        }
        return;
      case "emailTaken":
        form.setError("email", { message: t("errors.emailTaken") });
        return;
      case "roleNotFound":
      case "escalation":
        form.setError("roleKey", { message: t(`errors.${result.error}`) });
        return;
      case "forbidden":
        setFormError(t("errors.forbidden"));
        return;
      default:
        setFormError(t("errors.failed"));
    }
  }

  return (
    <>
      <Button disabled={!hydrated} onClick={() => setOpen(true)}>
        <UserPlusIcon />
        {t("add")}
      </Button>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          {created ? (
            <>
              <DialogHeader>
                <DialogTitle>{t("addedTitle")}</DialogTitle>
              </DialogHeader>
              <CredentialsPanel email={created.email} temporaryPassword={created.temporaryPassword} />
              <DialogFooter>
                <Button onClick={() => onOpenChange(false)}>{t("close")}</Button>
              </DialogFooter>
            </>
          ) : (
            <form onSubmit={form.handleSubmit(onSubmit)} method="post" noValidate className="flex flex-col gap-4">
              <DialogHeader>
                <DialogTitle>{t("addTitle")}</DialogTitle>
                <DialogDescription>{t("addDescription")}</DialogDescription>
              </DialogHeader>
              <FieldGroup>
                <Controller
                  name="name"
                  control={form.control}
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel htmlFor="member-name">{t("form.name")}</FieldLabel>
                      <Input
                        {...field}
                        id="member-name"
                        autoComplete="off"
                        placeholder={t("form.namePlaceholder")}
                        aria-invalid={fieldState.invalid}
                      />
                      <FieldError errors={[fieldState.error]} />
                    </Field>
                  )}
                />
                <Controller
                  name="email"
                  control={form.control}
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel htmlFor="member-email">{t("form.email")}</FieldLabel>
                      <Input
                        {...field}
                        id="member-email"
                        type="email"
                        autoComplete="off"
                        placeholder={t("form.emailPlaceholder")}
                        aria-invalid={fieldState.invalid}
                      />
                      <FieldDescription>{t("form.emailHelp")}</FieldDescription>
                      <FieldError errors={[fieldState.error]} />
                    </Field>
                  )}
                />
                <Controller
                  name="roleKey"
                  control={form.control}
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel htmlFor="member-role">{t("form.role")}</FieldLabel>
                      <RoleSelect
                        id="member-role"
                        value={field.value}
                        onChange={field.onChange}
                        roles={roles}
                        invalid={fieldState.invalid}
                      />
                      {roleDescription(roles, roleKey) && <FieldDescription>{roleDescription(roles, roleKey)}</FieldDescription>}
                      <FieldError errors={[fieldState.error]} />
                    </Field>
                  )}
                />
                {formError && <FieldError>{formError}</FieldError>}
              </FieldGroup>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                  {t("cancel")}
                </Button>
                <Button type="submit" disabled={!hydrated || form.formState.isSubmitting || roles.length === 0}>
                  {form.formState.isSubmitting ? t("adding") : t("addSubmit")}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
