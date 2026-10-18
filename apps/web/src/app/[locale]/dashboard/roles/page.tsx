import { getTranslations, setRequestLocale } from "next-intl/server";
import { LockKeyhole } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { hasPermissions } from "@/lib/permissions";
import { MAX_COMPANY_ROLES, grantedResources } from "@/lib/roles";
import { countOwners, ensureCompanyRoles, listCompanyRoles } from "@/server/company-roles";
import { requirePanelSection } from "@/server/tenant";
import { RoleRowActions } from "./role-row-actions";

export default async function RolesPage({ params }: PageProps<"/[locale]/dashboard/roles">) {
  const { locale } = await params;
  setRequestLocale(locale);

  const merchant = await requirePanelSection(locale, "roles");
  // Companies created before roles existed get the presets the first time
  await ensureCompanyRoles(merchant.tenantId, locale);
  const [t, roles, owners] = await Promise.all([
    getTranslations("Roles"),
    listCompanyRoles(merchant.tenantId),
    countOwners(merchant.tenantId),
  ]);
  const full = roles.length >= MAX_COMPANY_ROLES;
  const resourceList = (resources: string[]) =>
    new Intl.ListFormat(locale, { type: "conjunction" }).format(resources.map((r) => t(`resources.${r}.name`)));

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("description")}</p>
        </div>
        {merchant.can({ role: ["create"] }) &&
          (full ? (
            <p className="text-sm text-muted-foreground">{t("errors.limit", { max: MAX_COMPANY_ROLES })}</p>
          ) : (
            <Link href="/dashboard/roles/new" className={buttonVariants()}>
              {t("new")}
            </Link>
          ))}
      </div>

      <ul className="flex flex-col divide-y rounded-lg border">
        <li className="flex flex-col gap-1 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <LockKeyhole className="size-4 text-muted-foreground" aria-hidden />
            <span className="font-medium">{t("owner.name")}</span>
            <Badge variant="secondary">{t("builtIn")}</Badge>
            <span className="text-xs text-muted-foreground">{t("members", { count: owners })}</span>
          </div>
          <p className="text-sm text-muted-foreground">{t("owner.description")}</p>
        </li>
        {roles.map((role) => (
          <li key={role.id} className="flex items-start justify-between gap-3 p-3">
            <div className="flex min-w-0 flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <Link href={`/dashboard/roles/${role.id}`} className="font-medium underline-offset-4 hover:underline">
                  {role.name}
                </Link>
                {role.presetKey && <Badge variant="outline">{t("preset")}</Badge>}
                <span className="text-xs text-muted-foreground">{t("members", { count: role.memberCount })}</span>
              </div>
              {role.description && <p className="text-sm text-muted-foreground">{role.description}</p>}
              <p className="text-xs text-muted-foreground">
                {t("grants", { list: resourceList(grantedResources(role.permissions)) })}
              </p>
            </div>
            <RoleRowActions
              id={role.id}
              name={role.name}
              memberCount={role.memberCount}
              aboveYours={!hasPermissions(merchant.permissions, role.permissions)}
              full={full}
            />
          </li>
        ))}
      </ul>
      {roles.length === 0 && <p className="text-sm text-muted-foreground">{t("empty")}</p>}
    </div>
  );
}
