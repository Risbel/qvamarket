import { headers } from "next/headers";
import { setRequestLocale } from "next-intl/server";
import { ImpersonationBanner } from "@/components/impersonation-banner";
import { PanelShell } from "@/components/panel-shell";
import type { PanelNavGroup, PanelNavKey } from "@/components/panel-sidebar";
import { StoreStatusBanner } from "@/components/store-status-banner";
import { can } from "@/lib/permissions";
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
  const allowed = (key: PanelNavKey, visible: boolean) => (visible ? [key] : []);
  const groups: PanelNavGroup[] = [
    { items: ["home", ...allowed("orders", can(context.role, { order: ["read"] }))] },
    {
      label: "catalog",
      items: [
        ...allowed("products", can(context.role, { product: ["read"] })),
        ...allowed("categories", can(context.role, { category: ["update"] })),
        ...allowed("promotions", can(context.role, { promotion: ["update"] })),
      ],
    },
    {
      label: "store",
      items: [
        ...allowed("settings", can(context.role, { store: ["update"] })),
      ],
    },
  ].filter((group): group is PanelNavGroup => group.items.length > 0);

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
      {children}
    </PanelShell>
  );
}
