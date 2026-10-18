import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link, redirect } from "@/i18n/navigation";
import { buttonVariants } from "@/components/ui/button";
import { ImpersonationBanner } from "@/components/impersonation-banner";
import { orgPath } from "@/lib/panel-paths";
import { requireUser } from "@/server/session";
import { defaultCompanyId } from "@/server/tenant";
import { SignOutButton } from "./sign-out-button";

/**
 * Entry point of the merchant panel (login, signup and invitations land here): opens the
 * session's company (its store list). Users without a company (the superadmin) get a plain
 * welcome page.
 */
export default async function DashboardPage({ params }: PageProps<"/[locale]/dashboard">) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await requireUser(locale);
  const tenantId = await defaultCompanyId(session.user.id, session.session.activeOrganizationId);
  if (tenantId) redirect({ href: orgPath(tenantId), locale });

  const t = await getTranslations("Dashboard");
  return (
    <div className="flex flex-1 flex-col">
      {session.session.impersonatedBy && <ImpersonationBanner targetEmail={session.user.email} />}
      <main className="flex flex-1 flex-col items-center justify-center gap-4">
        <h1 className="text-2xl font-semibold">{t("welcome", { name: session.user.name })}</h1>
        <p className="text-muted-foreground">{session.user.email}</p>
        {session.user.role === "admin" && (
          <Link href="/admin" className={buttonVariants()}>
            {t("admin")}
          </Link>
        )}
        <SignOutButton />
      </main>
    </div>
  );
}
