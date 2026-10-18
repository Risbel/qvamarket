import { orgPath } from "@/lib/panel-paths";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { LocalDateTime } from "@/components/local-date-time";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { initials } from "@/lib/initials";
import {
  OWNER_PERMISSIONS,
  hasPermissions,
  isOwner,
  mergePermissions,
  roleKeys,
} from "@/lib/permissions";
import { ensureCompanyRoles, listCompanyRoles } from "@/server/company-roles";
import { listInvitations } from "@/server/invitations";
import { listTeamMembers } from "@/server/team";
import { requireCompanySection } from "@/server/tenant";
import { AddMemberDialog } from "./add-member-dialog";
import { InvitationsList } from "./invitations-list";
import { MemberRowActions } from "./member-row-actions";
import type { RoleOption } from "./role-select";

export default async function TeamPage({ params }: PageProps<"/[locale]/dashboard/org/[orgId]/team">) {
  const { locale, orgId } = await params;
  setRequestLocale(locale);

  const merchant = await requireCompanySection(locale, orgId, "team");
  // Companies created before roles existed get the presets, so there is something to give
  await ensureCompanyRoles(merchant.tenantId, locale);
  const [t, members, roles, invitations] = await Promise.all([
    getTranslations("Team"),
    listTeamMembers(merchant.tenantId),
    listCompanyRoles(merchant.tenantId),
    listInvitations(merchant.tenantId),
  ]);

  const rolesByKey = new Map(roles.map((role) => [role.key, role]));
  // Only roles the member could give (the server re-checks): never more than their own
  const grantable: RoleOption[] = roles
    .filter((role) => hasPermissions(merchant.permissions, role.permissions))
    .map((role) => ({ key: role.key, name: role.name, description: role.description }));
  const roleNames = (roleString: string) =>
    roleKeys(roleString).map((key) =>
      key === "owner" ? t("owner") : (rolesByKey.get(key)?.name ?? t("unknownRole")),
    );
  const permissionsOf = (roleString: string) =>
    isOwner(roleString)
      ? OWNER_PERMISSIONS
      : mergePermissions(roleKeys(roleString).map((key) => rolesByKey.get(key)?.permissions ?? {}));

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("description")}</p>
        </div>
        {merchant.can({ team: ["create"] }) && <AddMemberDialog roles={grantable} />}
      </div>

      <ul className="flex flex-col divide-y rounded-lg border">
        {members.map((m) => {
          const self = m.userId === merchant.session.user.id;
          return (
            <li key={m.id} className="flex items-start justify-between gap-3 p-3">
              <div className="flex min-w-0 items-start gap-3">
                <Avatar>
                  <AvatarFallback>{initials(m.name)}</AvatarFallback>
                </Avatar>
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{m.name}</span>
                    {self && <Badge variant="secondary">{t("you")}</Badge>}
                    {!self && m.otherCompanies && <Badge variant="secondary">{t("otherCompanies")}</Badge>}
                    {roleNames(m.role).map((name, index) => (
                      <Badge key={`${name}-${index}`} variant="outline">
                        {name}
                      </Badge>
                    ))}
                  </div>
                  <span className="truncate text-sm text-muted-foreground">{m.email}</span>
                  <span className="text-xs text-muted-foreground">
                    {t("joined")} <LocalDateTime iso={m.joinedAt.toISOString()} locale={locale} />
                    {m.mustChangePassword && <> · {t("pendingPassword")}</>}
                  </span>
                </div>
              </div>
              {!self && !isOwner(m.role) && (
                <MemberRowActions
                  memberId={m.id}
                  name={m.name}
                  email={m.email}
                  roleKey={roleKeys(m.role)[0] ?? ""}
                  roles={grantable}
                  aboveYours={!hasPermissions(merchant.permissions, permissionsOf(m.role))}
                  sharedAccount={m.sharedAccount}
                />
              )}
            </li>
          );
        })}
      </ul>
      <InvitationsList
        invitations={invitations.map((invitation) => ({
          id: invitation.id,
          email: invitation.email,
          roleName: invitation.roleName,
          inviterName: invitation.inviterName,
          expiresAt: invitation.expiresAt.toISOString(),
        }))}
      />
      {merchant.can({ role: ["read"] }) && (
        <p className="text-sm text-muted-foreground">
          {t.rich("rolesHint", {
            link: (chunks) => (
              <Link href={orgPath(orgId, "/roles")} className="font-medium text-foreground underline underline-offset-4">
                {chunks}
              </Link>
            ),
          })}
        </p>
      )}
    </div>
  );
}
