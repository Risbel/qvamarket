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
import { getIncomeSummary } from "@/server/income";
import { IncomeSummary } from "./income-summary";
import { PANEL_ACCESS } from "@/lib/panel-access";
import { orgPath, storePath } from "@/lib/panel-paths";
import { requireMerchant } from "@/server/tenant";

export default async function StoreHomePage({
  params,
}: PageProps<"/[locale]/dashboard/store/[storeId]">) {
  const { locale, storeId } = await params;
  setRequestLocale(locale);

  const merchant = await requireMerchant(locale, storeId);
  const t = await getTranslations("Dashboard");

  const canSeeProducts = merchant.can(PANEL_ACCESS.products);
  const counts = canSeeProducts
    ? await countProductsByStatus({
        tenantId: merchant.tenantId,
        storeId: merchant.store.id,
      })
    : {};
  const income = merchant.can(PANEL_ACCESS.income)
    ? await getIncomeSummary(
        { tenantId: merchant.tenantId, storeId: merchant.store.id },
        merchant.store.timeZone,
        merchant.store.currencies.map((c) => c.code),
      )
    : null;
  const storeUrl = buildStoreUrl(merchant.store.slug, (await headers()).get("host"));

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 p-4">
      <h1 className="text-2xl font-semibold">
        {t("welcome", { name: merchant.session.user.name })}
      </h1>
      {income && (
        <IncomeSummary
          summary={income}
          showProfit={merchant.can({ inventory: ["read"] })}
          profitLink={merchant.can(PANEL_ACCESS.profit)}
          advanced={merchant.hasFeature("advancedReports")}
          upgradeHref={merchant.isOwner ? orgPath(merchant.tenantId, "/billing") : null}
        />
      )}
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
            <Link href={storePath(merchant.store.id, "/products")} className={buttonVariants()}>
              {t("store.manageProducts")}
            </Link>
          </CardContent>
        )}
      </Card>
    </div>
  );
}
