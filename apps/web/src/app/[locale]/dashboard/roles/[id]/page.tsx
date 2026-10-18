import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { z } from "zod";
import { hasPermissions } from "@/lib/permissions";
import { getCompanyRole } from "@/server/company-roles";
import { requireMerchantPermission } from "@/server/tenant";
import type { PermissionValue } from "../permission-matrix";
import { RoleForm } from "../role-form";

export default async function EditRolePage({ params }: PageProps<"/[locale]/dashboard/roles/[id]">) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  // role:read opens it; without role:update (or when the role grants more than the member
  // has) the form is read-only, and the action refuses the save anyway
  const merchant = await requireMerchantPermission(locale, { role: ["read"] });
  if (!z.uuid().safeParse(id).success) notFound();
  // Scoped by tenant: another company's role is a 404
  const role = await getCompanyRole(merchant.tenantId, id.toLowerCase());
  if (!role) notFound();
  const t = await getTranslations("Roles");
  const editable = merchant.can({ role: ["update"] });

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 p-4">
      <div>
        <h1 className="text-2xl font-semibold">{editable ? t("form.editTitle") : role.name}</h1>
        <p className="text-sm text-muted-foreground">{t("form.formDescription")}</p>
      </div>
      <RoleForm
        roleId={role.id}
        lockedReason={hasPermissions(merchant.permissions, role.permissions) ? undefined : t("form.aboveYours")}
        initialValues={{
          name: role.name,
          description: role.description ?? "",
          permissions: role.permissions as PermissionValue,
        }}
      />
    </div>
  );
}
