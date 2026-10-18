import { orgPath } from "@/lib/panel-paths";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { z } from "zod";
import { Link } from "@/i18n/navigation";
import { ROLE_PRESET_KEYS, hasPermissions, presetPermissions } from "@/lib/permissions";
import { MAX_COMPANY_ROLES, ROLE_NAME_MAX } from "@/lib/roles";
import { getCompanyRole, listCompanyRoles } from "@/server/company-roles";
import { requireCompanyPermission } from "@/server/tenant";
import type { PermissionValue } from "../permission-matrix";
import { RoleForm, type RoleTemplate } from "../role-form";

export default async function NewRolePage({ params, searchParams }: PageProps<"/[locale]/dashboard/org/[orgId]/roles/new">) {
  const { locale, orgId } = await params;
  setRequestLocale(locale);

  const merchant = await requireCompanyPermission(locale, orgId, { role: ["create"] });
  const t = await getTranslations("Roles");
  const roles = await listCompanyRoles(merchant.tenantId);

  // ?from=<role id>: duplicate one of the company's roles (only one the member could create)
  const from = (await searchParams).from;
  const fromId = typeof from === "string" && z.uuid().safeParse(from).success ? from : null;
  const source = fromId ? await getCompanyRole(merchant.tenantId, fromId) : null;
  const copy = source && hasPermissions(merchant.permissions, source.permissions) ? source : null;

  // Templates = the presets, limited to what this member may grant
  const templates: RoleTemplate[] = ROLE_PRESET_KEYS.map((key) => ({
    key,
    name: t(`presets.${key}.name`),
    description: t(`presets.${key}.description`),
    permissions: presetPermissions(key) as PermissionValue,
  })).filter((tpl) => hasPermissions(merchant.permissions, tpl.permissions));

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 p-4">
      <div>
        <h1 className="text-2xl font-semibold">{t("form.newTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("form.formDescription")}</p>
      </div>
      {roles.length >= MAX_COMPANY_ROLES ? (
        <p className="text-sm text-muted-foreground">
          {t("errors.limit", { max: MAX_COMPANY_ROLES })}{" "}
          <Link href={orgPath(orgId, "/roles")} className="underline underline-offset-4">
            {t("form.back")}
          </Link>
        </p>
      ) : (
        <RoleForm
          templates={copy ? [] : templates}
          initialValues={{
            name: copy ? t("form.copyName", { name: copy.name }).slice(0, ROLE_NAME_MAX) : "",
            description: copy?.description ?? "",
            permissions: (copy?.permissions ?? {}) as PermissionValue,
          }}
        />
      )}
    </div>
  );
}
