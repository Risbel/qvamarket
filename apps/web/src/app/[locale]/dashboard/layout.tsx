import { setRequestLocale } from "next-intl/server";
import { ImpersonationBanner } from "@/components/impersonation-banner";
import { PanelNav, type PanelNavKey } from "@/components/panel-nav";
import { can } from "@/lib/permissions";
import { getMerchantContext } from "@/server/tenant";
import { requireUser } from "@/server/session";
import { SignOutButton } from "./sign-out-button";

export default async function DashboardLayout({
  children,
  params,
}: LayoutProps<"/[locale]/dashboard">) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await requireUser(locale);
  const context = await getMerchantContext(session.user.id);
  const impersonating = Boolean(session.session.impersonatedBy);
  // Only show what the member's role allows (the pages enforce it again on the server)
  const visibleNav: PanelNavKey[] = ["home"];
  if (context && can(context.role, { product: ["read"] })) visibleNav.push("products");

  return (
    <div className="flex flex-1 flex-col">
      {impersonating && <ImpersonationBanner targetEmail={session.user.email} />}
      {context && (
        <header className="border-b">
          <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-3 p-4">
            <div className="flex flex-wrap items-center gap-4">
              <div className="leading-tight">
                <div className="font-semibold">{context.store.name}</div>
                <div className="text-xs text-muted-foreground">{context.companyName}</div>
              </div>
              <PanelNav visible={visibleNav} />
            </div>
            <div className="flex items-center gap-3">
              <span className="hidden text-sm text-muted-foreground sm:inline">
                {session.user.email}
              </span>
              {!impersonating && <SignOutButton />}
            </div>
          </div>
        </header>
      )}
      {children}
    </div>
  );
}
