import { headers } from "next/headers";
import { setRequestLocale } from "next-intl/server";
import { ImpersonationBanner } from "@/components/impersonation-banner";
import { PanelShell } from "@/components/panel-shell";
import type { PanelNavGroup, PanelNavKey } from "@/components/panel-sidebar";
import { StoreStatusBanner } from "@/components/store-status-banner";
import { PANEL_ACCESS, type PanelSection } from "@/lib/panel-access";
import { hasPermissions } from "@/lib/permissions";
import { PermissionsProvider } from "@/components/permissions/permissions-provider";
import { buildStoreUrl } from "@/lib/tenancy";
import { getMerchantContext } from "@/server/tenant";
import { requireUser } from "@/server/session";
import { publicUrl } from "@/server/storage";

export default async function DashboardLayout({
  children,
  params,
}: LayoutProps<"/[locale]/dashboard">) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await requireUser(locale);
  const context = await getMerchantContext(session.user.id);
  const impersonating = Boolean(session.session.impersonatedBy);
  const banner = impersonating && <ImpersonationBanner targetEmail={session.user.email} />;

  // Users without a company (the superadmin) get the plain welcome page, no panel
  if (!context) {
    return (
      <div className="flex flex-1 flex-col">
        {banner}
        {children}
      </div>
    );
  }

  // Only show what the member's role allows (the pages enforce it again on the server)
  const allowed = (...sections: (PanelSection & PanelNavKey)[]) =>
    sections.filter((section) => hasPermissions(context.permissions, PANEL_ACCESS[section]));
  const groups = ([
    { items: ["home", ...allowed("orders")] },
    { label: "catalog", items: allowed("products", "categories", "promotions") },
    { label: "store", items: allowed("settings") },
    { label: "team", items: allowed("roles") },
  ] satisfies PanelNavGroup[]).filter((group) => group.items.length > 0);

  return (
    <PanelShell
      groups={groups}
      brand={{
        title: context.store.name,
        subtitle: context.companyName,
        logoUrl: context.store.logoKey ? publicUrl(context.store.logoKey) : null,
        href: "/dashboard",
      }}
      user={{ name: session.user.name, email: session.user.email }}
      storeUrl={buildStoreUrl(context.store.slug, (await headers()).get("host"))}
      impersonating={impersonating}
      banners={
        <>
          {banner}
          {context.store.status !== "active" && <StoreStatusBanner status={context.store.status} />}
        </>
      }
    >
      <PermissionsProvider permissions={context.permissions}>{children}</PermissionsProvider>
    </PanelShell>
  );
}
