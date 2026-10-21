import { headers } from "next/headers";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ImpersonationBanner } from "@/components/impersonation-banner";
import { PanelShell } from "@/components/panel-shell";
import type { PanelNavGroup, PanelNavKey } from "@/components/panel-sidebar";
import { PermissionsProvider } from "@/components/permissions/permissions-provider";
import { StoreStatusBanner } from "@/components/store-status-banner";
import { PANEL_ACCESS, type StoreSection } from "@/lib/panel-access";
import { orgPath, storePath } from "@/lib/panel-paths";
import { buildStoreUrl } from "@/lib/tenancy";
import { publicUrl } from "@/server/storage";
import { requireMerchant } from "@/server/tenant";

/** A store's panel (/dashboard/store/<storeId>/...): orders, catalog and settings. */
export default async function StoreLayout({ children, params }: LayoutProps<"/[locale]/dashboard/store/[storeId]">) {
  const { locale, storeId } = await params;
  setRequestLocale(locale);

  const merchant = await requireMerchant(locale, storeId);
  const t = await getTranslations("Panel");
  const { session, store } = merchant;
  const impersonating = Boolean(session.session.impersonatedBy);

  // Only show what the member's role allows (the pages enforce it again on the server)
  const allowed = (...sections: (StoreSection & PanelNavKey)[]) => sections.filter((s) => merchant.can(PANEL_ACCESS[s]));
  const groups = ([
    { items: ["home", ...allowed("orders", "customers")] },
    { label: "catalog", items: allowed("products", "inventory", "categories", "promotions") },
    { label: "finance", items: allowed("expenses") },
    { label: "store", items: allowed("settings") },
  ] satisfies PanelNavGroup[]).filter((group) => group.items.length > 0);

  return (
    <PanelShell
      basePath={storePath(store.id)}
      groups={groups}
      brand={{
        title: store.name,
        subtitle: merchant.companyName,
        logoUrl: store.logoKey ? publicUrl(store.logoKey) : null,
        href: storePath(store.id),
      }}
      back={{ href: orgPath(merchant.tenantId), label: t("allStores") }}
      user={{ name: session.user.name, email: session.user.email }}
      storeUrl={buildStoreUrl(store.slug, (await headers()).get("host"))}
      impersonating={impersonating}
      banners={
        <>
          {impersonating && <ImpersonationBanner targetEmail={session.user.email} />}
          {store.status !== "active" && <StoreStatusBanner status={store.status} />}
        </>
      }
    >
      <PermissionsProvider permissions={merchant.permissions}>{children}</PermissionsProvider>
    </PanelShell>
  );
}
