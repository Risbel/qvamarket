import { headers } from "next/headers";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { SubscriptionBanner } from "@/components/billing/subscription-banner";
import { ImpersonationBanner } from "@/components/impersonation-banner";
import { PanelShell } from "@/components/panel-shell";
import type { PanelNavGroup, PanelNavKey } from "@/components/panel-sidebar";
import { PermissionsProvider } from "@/components/permissions/permissions-provider";
import { PlanProvider } from "@/components/plans/plan-provider";
import { StoreStatusBanner } from "@/components/store-status-banner";
import { PANEL_ACCESS, type StoreSection } from "@/lib/panel-access";
import { minimumPlanFor, type PlanKey } from "@/lib/plans";
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

  // Only show what the member's role allows (the pages enforce it again on the server). A
  // section the role allows but the plan does not stays, with a lock and the plan that has it.
  const locked: Partial<Record<PanelNavKey, PlanKey>> = {};
  const allowed = (...sections: (StoreSection & PanelNavKey)[]) =>
    sections.filter((s) => {
      if (merchant.can(PANEL_ACCESS[s])) return true;
      const feature = merchant.planLock(PANEL_ACCESS[s]);
      if (feature) locked[s] = minimumPlanFor(feature);
      return feature !== null;
    });
  const groups = ([
    { items: ["home", ...allowed("orders", "customers")] },
    { label: "catalog", items: allowed("products", "inventory", "categories", "promotions") },
    { label: "finance", items: allowed("expenses", "profit") },
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
      locked={locked}
      user={{ name: session.user.name, email: session.user.email }}
      storeUrl={buildStoreUrl(store.slug, (await headers()).get("host"))}
      impersonating={impersonating}
      banners={
        <>
          {impersonating && <ImpersonationBanner targetEmail={session.user.email} />}
          {store.status !== "active" && <StoreStatusBanner status={store.status} />}
          {merchant.isOwner && <SubscriptionBanner tenantId={merchant.tenantId} subscription={merchant.subscription} locale={locale} />}
        </>
      }
    >
      <PermissionsProvider permissions={merchant.effectivePermissions}>
        <PlanProvider plan={merchant.subscription.plan}>{children}</PlanProvider>
      </PermissionsProvider>
    </PanelShell>
  );
}
