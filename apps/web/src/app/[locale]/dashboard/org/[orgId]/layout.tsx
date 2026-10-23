import { getTranslations, setRequestLocale } from "next-intl/server";
import { ImpersonationBanner } from "@/components/impersonation-banner";
import { PanelShell } from "@/components/panel-shell";
import type { PanelNavGroup, PanelNavKey } from "@/components/panel-sidebar";
import { PermissionsProvider } from "@/components/permissions/permissions-provider";
import { PANEL_ACCESS, type CompanySection } from "@/lib/panel-access";
import { orgPath } from "@/lib/panel-paths";
import { requireCompany } from "@/server/tenant";

/** The company's panel (/dashboard/org/<tenantId>/...): its stores, team and roles. */
export default async function CompanyLayout({ children, params }: LayoutProps<"/[locale]/dashboard/org/[orgId]">) {
  const { locale, orgId } = await params;
  setRequestLocale(locale);

  const company = await requireCompany(locale, orgId);
  const t = await getTranslations("Panel");
  const { session } = company;
  const impersonating = Boolean(session.session.impersonatedBy);

  // Only show what the member's role allows (the pages enforce it again on the server)
  const allowed = (...sections: (CompanySection & PanelNavKey)[]) => sections.filter((s) => company.can(PANEL_ACCESS[s]));
  const groups = ([
    { items: ["stores"] },
    { label: "team", items: allowed("team", "roles") },
  ] satisfies PanelNavGroup[]).filter((group) => group.items.length > 0);

  return (
    <PanelShell
      basePath={orgPath(company.tenantId)}
      groups={groups}
      brand={{
        title: company.companyName,
        subtitle: t("company.label"),
        logoUrl: null,
        href: orgPath(company.tenantId),
        icon: "company",
      }}
      user={{ name: session.user.name, email: session.user.email }}
      impersonating={impersonating}
      companies={company.companies}
      activeCompanyId={company.tenantId}
      banners={impersonating && <ImpersonationBanner targetEmail={session.user.email} />}
    >
      <PermissionsProvider permissions={company.effectivePermissions}>{children}</PermissionsProvider>
    </PanelShell>
  );
}
