import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { billingNotice, type EffectiveSubscription } from "@/lib/billing";
import { orgPath } from "@/lib/panel-paths";
import { LocalDateTime } from "@/components/local-date-time";

/**
 * Shown to the company's owners while the subscription needs attention (`billingNotice`):
 * payment overdue (with the day the plan ends), paused, or a trial ending soon. Links to Billing.
 */
export function SubscriptionBanner({
  tenantId,
  subscription,
  locale,
}: {
  tenantId: string;
  subscription: EffectiveSubscription;
  locale: string;
}) {
  const t = useTranslations("CompanyBilling.banner");
  const notice = billingNotice(subscription);
  if (!notice) return null;
  return (
    <div
      role="status"
      className={
        notice.kind === "pastDue"
          ? "bg-destructive/10 px-4 py-2 text-center text-sm text-destructive"
          : "bg-amber-50 px-4 py-2 text-center text-sm text-amber-950 dark:bg-amber-950 dark:text-amber-50"
      }
    >
      {t(notice.kind)} {notice.date && <LocalDateTime iso={notice.date.toISOString()} locale={locale} />}{" "}
      <Link href={orgPath(tenantId, "/billing")} className="font-medium underline underline-offset-4">
        {t("link")}
      </Link>
    </div>
  );
}
