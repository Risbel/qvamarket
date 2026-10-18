import { getTranslations, setRequestLocale } from "next-intl/server";
import { headers } from "next/headers";
import { Link } from "@/i18n/navigation";
import { buildStoreUrl } from "@/lib/tenancy";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { countProductsByStatus } from "@/server/products";
import { PANEL_ACCESS } from "@/lib/panel-access";
import { hasPermissions } from "@/lib/permissions";
import { requireUser } from "@/server/session";
import { getMerchantContext } from "@/server/tenant";
import { SignOutButton } from "./sign-out-button";

export default async function DashboardPage({
  params,
}: PageProps<"/[locale]/dashboard">) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await requireUser(locale);
  const merchant = await getMerchantContext(session.user.id, session.session.activeOrganizationId);
  const t = await getTranslations("Dashboard");

  // Users without a company (the superadmin): plain welcome + link to the admin panel
  if (!merchant) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-4">
        <h1 className="text-2xl font-semibold">
          {t("welcome", { name: session.user.name })}
        </h1>
        <p className="text-muted-foreground">{session.user.email}</p>
        {session.user.role === "admin" && (
          <Link href="/admin" className={buttonVariants()}>
            {t("admin")}
          </Link>
        )}
        <SignOutButton />
      </main>
    );
  }

  const canSeeProducts = hasPermissions(merchant.permissions, PANEL_ACCESS.products);
  const counts = canSeeProducts
    ? await countProductsByStatus({
        tenantId: merchant.tenantId,
        storeId: merchant.store.id,
      })
    : {};
  const storeUrl = buildStoreUrl(merchant.store.slug, (await headers()).get("host"));

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 p-4">
      <h1 className="text-2xl font-semibold">
        {t("welcome", { name: session.user.name })}
      </h1>
      <Card>
        <CardHeader>
          <CardTitle>{merchant.store.name}</CardTitle>
          <CardDescription>
            <a
              href={storeUrl}
              target="_blank"
              rel="noreferrer"
              className="underline-offset-4 hover:underline"
            >
              {storeUrl}
            </a>
          </CardDescription>
        </CardHeader>
        {canSeeProducts && (
          <CardContent className="flex flex-wrap items-center justify-between gap-4">
            <dl className="flex gap-8 text-sm">
              <div>
                <dt className="text-muted-foreground">{t("store.active")}</dt>
                <dd className="text-2xl font-semibold">{counts.active ?? 0}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t("store.draft")}</dt>
                <dd className="text-2xl font-semibold">{counts.draft ?? 0}</dd>
              </div>
            </dl>
            <Link href="/dashboard/products" className={buttonVariants()}>
              {t("store.manageProducts")}
            </Link>
          </CardContent>
        )}
      </Card>
    </div>
  );
}
