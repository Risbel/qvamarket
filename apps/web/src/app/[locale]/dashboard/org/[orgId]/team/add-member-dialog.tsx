"use client";

import { useOrgId } from "@/components/panel-scope";
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
import { createInvitationAction } from "@/server/invitation-actions";
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
import { InviteLinkPanel } from "./invite-link-panel";
import { RoleSelect, roleDescription, type RoleOption } from "./role-select";

const INVITATION_ERRORS = ["forbidden", "alreadyMember", "limit", "roleNotFound", "escalation", "noAccount"];

/**
 * Adds a team member: name, email and role. The server creates the account with a temporary
 * password, shown here once (the member must change it on first sign-in). An email that
 * already has an account cannot get a new one: the dialog offers an invitation link instead,
 * which that person accepts with their own account.
 */
export function AddMemberDialog({ roles }: { roles: RoleOption[] }) {
  const orgId = useOrgId();
  const t = useTranslations("Team");
  const tv = useTranslations("Validation");
  const locale = useLocale();
  const router = useRouter();
  const hydrated = useHydrated();
  const [open, setOpen] = useState(false);
  const [created, setCreated] = useState<{ email: string; temporaryPassword: string } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  // The email already has an account: offer to invite it instead
  const [existing, setExisting] = useState<{ email: string; roleKey: string } | null>(null);
  const [invited, setInvited] = useState<{ id: string; email: string } | null>(null);
  const [inviting, setInviting] = useState(false);

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
      setExisting(null);
      setInvited(null);
      form.reset(defaultValues);
    }
  }

  async function invite() {
    if (!existing) return;
    setInviting(true);
    setFormError(null);
    const result = await createInvitationAction(orgId, existing, locale).catch(() => null);
    setInviting(false);
    if (result?.ok && result.id) {
      setInvited({ id: result.id, email: existing.email });
      router.refresh();
      return;
    }
    const error = result && !result.ok ? result.error : "failed";
    setFormError(t(`invitationErrors.${INVITATION_ERRORS.includes(error) ? error : "failed"}`));
  }

  async function onSubmit(values: TeamMemberValues) {
    setFormError(null);
    setExisting(null);
    const result = await addTeamMemberAction(orgId, values, locale).catch(() => null);
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
        setExisting({ email: values.email, roleKey: values.roleKey });
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
          {invited ? (
            <>
              <DialogHeader>
                <DialogTitle>{t("invitedTitle")}</DialogTitle>
              </DialogHeader>
              <InviteLinkPanel id={invited.id} email={invited.email} />
              <DialogFooter>
                <Button onClick={() => onOpenChange(false)}>{t("close")}</Button>
              </DialogFooter>
            </>
          ) : created ? (
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
                {existing && (
                  <div role="status" className="flex flex-col gap-2 rounded-md border bg-muted p-3 text-sm">
                    <p>{t("hasAccount", { email: existing.email })}</p>
                    <Button type="button" className="self-start" disabled={inviting} onClick={invite}>
                      {inviting ? t("inviting") : t("inviteInstead")}
                    </Button>
                  </div>
                )}
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
