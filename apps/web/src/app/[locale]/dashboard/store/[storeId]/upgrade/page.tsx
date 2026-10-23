import { LockIcon } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { orgPath, storePath } from "@/lib/panel-paths";
import { PLAN_FEATURES, minimumPlanFor, type PlanFeature } from "@/lib/plans";
import { buttonVariants } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { requireMerchant } from "@/server/tenant";

/**
 * Where a section the company's plan does not include leads (requireMerchantPermission sends
 * members here when their role would allow it): what the feature does, from which plan, and
 * for owners a link to the plans.
 */
export default async function UpgradePage({ params, searchParams }: PageProps<"/[locale]/dashboard/store/[storeId]/upgrade">) {
  const { locale, storeId } = await params;
  setRequestLocale(locale);
  const merchant = await requireMerchant(locale, storeId);
  const t = await getTranslations("Plans.upgrade");
  const tp = await getTranslations("Plans.plans");
  const tf = await getTranslations("CompanyBilling.features");
  const raw = (await searchParams).feature;
  const feature = (PLAN_FEATURES as readonly string[]).includes(String(raw)) ? (raw as PlanFeature) : null;
  const plan = feature ? minimumPlanFor(feature) : "pro";

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col p-4">
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <LockIcon />
          </EmptyMedia>
          <EmptyTitle>{feature ? t("title", { feature: tf(feature), plan: tp(`${plan}.name`) }) : t("genericTitle")}</EmptyTitle>
          <EmptyDescription>
            {feature && t(`about.${feature}`)} {t("current", { plan: tp(`${merchant.subscription.plan}.name`) })}
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          {merchant.isOwner ? (
            <Link href={orgPath(merchant.tenantId, "/billing")} className={buttonVariants()}>
              {t("seePlans")}
            </Link>
          ) : (
            <p className="text-sm text-muted-foreground">{t("askOwner")}</p>
          )}
          <Link href={storePath(merchant.store.id)} className={buttonVariants({ variant: "ghost" })}>
            {t("back")}
          </Link>
        </EmptyContent>
      </Empty>
    </div>
  );
}
