"use client";

import { useOrgId } from "@/components/panel-scope";
import { useState } from "react";
import { KeyRoundIcon, MoreHorizontalIcon, ShieldCheckIcon, UserMinusIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { useRouter } from "@/i18n/navigation";
import { useCan } from "@/components/permissions/permissions-provider";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import {
  changeMemberRoleAction,
  removeTeamMemberAction,
  resetMemberPasswordAction,
} from "@/server/team-actions";
import { CredentialsPanel } from "./credentials-panel";
import { RoleSelect, roleDescription, type RoleOption } from "./role-select";

type Open = "role" | "reset" | "remove" | null;

const KNOWN_ERRORS = ["forbidden", "notFound", "self", "owner", "escalation", "roleNotFound", "sharedAccount"];

/**
 * `...` menu of a team member: change role, reset password (team:update), remove from the
 * team (team:delete). Not rendered for yourself or an owner, nor for a member whose
 * permissions exceed yours. The server re-checks all of it.
 */
export function MemberRowActions({
  memberId,
  name,
  email,
  roleKey,
  roles,
  aboveYours,
  sharedAccount,
}: {
  memberId: string;
  name: string;
  email: string;
  /** the member's current role key (the first one if several) */
  roleKey: string;
  roles: RoleOption[];
  aboveYours: boolean;
  /** the account is also used elsewhere: only the person can change its password */
  sharedAccount: boolean;
}) {
  const orgId = useOrgId();
  const t = useTranslations("Team");
  const locale = useLocale();
  const router = useRouter();
  const can = useCan();
  const [open, setOpen] = useState<Open>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextRole, setNextRole] = useState(roleKey);
  const [credentials, setCredentials] = useState<{ email: string; temporaryPassword: string } | null>(null);

  const canUpdate = can({ team: ["update"] }) && !aboveYours;
  const canRemove = can({ team: ["delete"] }) && !aboveYours;
  if (!canUpdate && !canRemove) return null;

  function show(dialog: Open) {
    setError(null);
    setCredentials(null);
    setNextRole(roleKey);
    setOpen(dialog);
  }

  function close() {
    if (busy) return;
    setOpen(null);
    // Forget the credentials as soon as the dialog closes
    setCredentials(null);
  }

  /** Runs an action; on failure shows its error. Returns the result when it succeeded. */
  async function run<T extends { ok: boolean; error?: string }>(action: () => Promise<T>): Promise<T | null> {
    setBusy(true);
    setError(null);
    const result = await action().catch(() => null);
    setBusy(false);
    router.refresh();
    if (result?.ok) return result;
    setError(t(`errors.${result?.error && KNOWN_ERRORS.includes(result.error) ? result.error : "failed"}`));
    return null;
  }

  async function changeRole() {
    if (await run(() => changeMemberRoleAction(orgId, memberId, { roleKey: nextRole }, locale))) {
      toast.success(t("toasts.roleChanged", { name }));
      setOpen(null);
    }
  }

  async function resetPassword() {
    const result = await run(() => resetMemberPasswordAction(orgId, memberId));
    if (result?.ok) setCredentials({ email: result.email, temporaryPassword: result.temporaryPassword });
  }

  async function remove() {
    if (await run(() => removeTeamMemberAction(orgId, memberId))) {
      toast.success(t("toasts.removed", { name }));
      setOpen(null);
    }
  }

  const errorLine = error && (
    <p role="alert" className="text-sm text-destructive">
      {error}
    </p>
  );

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={t("actions.menu", { name })} />}>
          <MoreHorizontalIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-auto min-w-48">
          {canUpdate && (
            <>
              <DropdownMenuItem onClick={() => show("role")}>
                <ShieldCheckIcon />
                {t("actions.changeRole")}
              </DropdownMenuItem>
              <DropdownMenuItem disabled={sharedAccount} onClick={() => show("reset")}>
                <KeyRoundIcon />
                {sharedAccount ? t("actions.resetPasswordShared") : t("actions.resetPassword")}
              </DropdownMenuItem>
            </>
          )}
          {canRemove && (
            <>
              {canUpdate && <DropdownMenuSeparator />}
              <DropdownMenuItem variant="destructive" onClick={() => show("remove")}>
                <UserMinusIcon />
                {t("actions.remove")}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={open === "role"} onOpenChange={(next) => !next && close()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("changeRoleTitle", { name })}</DialogTitle>
            <DialogDescription>{t("changeRoleDescription")}</DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor={`role-${memberId}`}>{t("form.role")}</FieldLabel>
            <RoleSelect id={`role-${memberId}`} value={nextRole} onChange={setNextRole} roles={roles} disabled={busy} />
            {roleDescription(roles, nextRole) && <FieldDescription>{roleDescription(roles, nextRole)}</FieldDescription>}
          </Field>
          {errorLine}
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={close}>
              {t("cancel")}
            </Button>
            <Button disabled={busy || !nextRole || nextRole === roleKey} onClick={changeRole}>
              {t("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={open === "reset"} onOpenChange={(next) => !next && close()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{credentials ? t("resetDoneTitle") : t("resetTitle")}</DialogTitle>
            {!credentials && <DialogDescription>{t("resetConfirm", { name, email })}</DialogDescription>}
          </DialogHeader>
          {credentials && <CredentialsPanel email={credentials.email} temporaryPassword={credentials.temporaryPassword} />}
          {errorLine}
          <DialogFooter>
            {credentials ? (
              <Button onClick={close}>{t("close")}</Button>
            ) : (
              <>
                <Button variant="outline" disabled={busy} onClick={close}>
                  {t("cancel")}
                </Button>
                <Button disabled={busy} onClick={resetPassword}>
                  {busy ? t("resetting") : t("resetSubmit")}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={open === "remove"} onOpenChange={(next) => !next && close()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("removeTitle")}</DialogTitle>
            <DialogDescription>{t("removeConfirm", { name })}</DialogDescription>
          </DialogHeader>
          {errorLine}
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={close}>
              {t("cancel")}
            </Button>
            <Button variant="destructive" disabled={busy} onClick={remove}>
              {t("actions.remove")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
