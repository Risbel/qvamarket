import { storePath } from "@/lib/panel-paths";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { LocalDateTime } from "@/components/local-date-time";
import { buttonVariants } from "@/components/ui/button";
import { promotionState } from "@/lib/promotions";
import { listPromotions } from "@/server/promotions";
import { requirePanelSection } from "@/server/tenant";
import { PromotionRowActions } from "./promotion-row-actions";

const stateStyle = {
  draft: "bg-muted text-muted-foreground",
  scheduled: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  running: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  ended: "bg-muted text-muted-foreground",
} as const;

export default async function PromotionsPage({ params }: PageProps<"/[locale]/dashboard/store/[storeId]/promotions">) {
  const { locale, storeId } = await params;
  setRequestLocale(locale);

  const merchant = await requirePanelSection(locale, storeId, "promotions");
  const t = await getTranslations("Promotions");
  const promotions = await listPromotions({ tenantId: merchant.tenantId, storeId: merchant.store.id });
  const now = new Date();

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("description")}</p>
        </div>
        {merchant.can({ promotion: ["create"] }) && (
          <Link href={storePath(storeId, "/promotions/new")} className={buttonVariants()}>
            {t("new")}
          </Link>
        )}
      </div>

      {promotions.length === 0 ? (
        <p className="text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="flex flex-col divide-y rounded-lg border">
          {promotions.map((promotion) => {
            const state = promotionState(promotion.status, promotion.startsAt, promotion.endsAt, now);
            return (
              <li key={promotion.id} className="flex flex-wrap items-center justify-between gap-3 p-3" data-promotion={promotion.name}>
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={storePath(storeId, `/promotions/${promotion.id}`)} className="font-medium underline-offset-4 hover:underline">
                      {promotion.name}
                    </Link>
                    <span className={`rounded-full px-2 py-0.5 text-xs ${stateStyle[state]}`} data-testid="promotion-state">
                      {t(`states.${state}`)}
                    </span>
                    <span className="text-xs text-muted-foreground">{t(`kinds.${promotion.kind as "sale" | "override"}`)}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {t("productCount", { count: promotion.productCount })}
                    {promotion.startsAt && (
                      <>
                        {" · "}
                        {t("from")} <LocalDateTime iso={promotion.startsAt.toISOString()} locale={locale} />
                      </>
                    )}
                    {promotion.endsAt && (
                      <>
                        {" · "}
                        {t("until")} <LocalDateTime iso={promotion.endsAt.toISOString()} locale={locale} />
                      </>
                    )}
                  </div>
                </div>
                <PromotionRowActions
                  id={promotion.id}
                  name={promotion.name}
                  active={promotion.status === "active"}
                />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
