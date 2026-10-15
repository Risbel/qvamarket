import { headers } from "next/headers";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ExternalLink } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { buttonVariants } from "@/components/ui/button";
import { MAX_STORE_PAGES } from "@/lib/store-pages";
import { buildStoreUrl } from "@/lib/tenancy";
import { listStorePages } from "@/server/store-pages";
import { requireMerchantPermission } from "@/server/tenant";
import { SectionHeader } from "../section-header";
import { DeletePageButton } from "./delete-page-button";

export default async function PagesSettingsPage({ params }: PageProps<"/[locale]/dashboard/settings/pages">) {
  const { locale } = await params;
  setRequestLocale(locale);

  const merchant = await requireMerchantPermission(locale, { store: ["update"] });
  const [t, pages, requestHeaders] = await Promise.all([
    getTranslations("Settings.pages"),
    listStorePages({ tenantId: merchant.tenantId, storeId: merchant.store.id }),
    headers(),
  ]);
  const storeUrl = buildStoreUrl(merchant.store.slug, requestHeaders.get("host"));
  const full = pages.length >= MAX_STORE_PAGES;

  return (
    <>
      <SectionHeader title={t("title")} description={t("description")} />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{t("count", { count: pages.length, max: MAX_STORE_PAGES })}</p>
        {full ? (
          <p className="text-sm text-muted-foreground">{t("limitReached")}</p>
        ) : (
          <Link href="/dashboard/settings/pages/new" className={buttonVariants()}>
            {t("new")}
          </Link>
        )}
      </div>

      {pages.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="flex flex-col divide-y rounded-lg border">
          {pages.map((page) => {
            const published = page.status === "published";
            return (
              <li key={page.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/dashboard/settings/pages/${page.id}`}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {page.title}
                    </Link>
                    <span
                      className={
                        published
                          ? "rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
                          : "rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                      }
                    >
                      {t(`statuses.${published ? "published" : "draft"}`)}
                    </span>
                  </div>
                  {published ? (
                    <a
                      href={`${storeUrl}/${locale}/${page.slug}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex w-fit items-center gap-1 text-xs text-muted-foreground underline-offset-4 hover:underline"
                    >
                      /{page.slug}
                      <ExternalLink className="size-3" aria-hidden />
                      <span className="sr-only">{t("opensInNewTab")}</span>
                    </a>
                  ) : (
                    <span className="text-xs text-muted-foreground">/{page.slug}</span>
                  )}
                </div>
                <div className="flex gap-1">
                  <Link
                    href={`/dashboard/settings/pages/${page.id}`}
                    className={buttonVariants({ size: "sm", variant: "outline" })}
                  >
                    {t("edit")}
                  </Link>
                  <DeletePageButton id={page.id} title={page.title} />
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <p className="mt-6 text-sm text-muted-foreground">
        {t.rich("footerHint", {
          link: (chunks) => (
            <Link href="/dashboard/settings/footer?tab=links" className="font-medium text-foreground underline underline-offset-4">
              {chunks}
            </Link>
          ),
        })}
      </p>
    </>
  );
}
