import { storePath } from "@/lib/panel-paths";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { MAX_STORE_PAGES } from "@/lib/store-pages";
import { listStorePages } from "@/server/store-pages";
import { requireMerchantPermission } from "@/server/tenant";
import { SectionHeader } from "../../section-header";
import { PageForm } from "../page-form";

export default async function NewStorePagePage({ params }: PageProps<"/[locale]/dashboard/store/[storeId]/settings/pages/new">) {
  const { locale, storeId } = await params;
  setRequestLocale(locale);

  const merchant = await requireMerchantPermission(locale, storeId, { store: ["update"] });
  const t = await getTranslations("Settings.pages");
  const pages = await listStorePages({ tenantId: merchant.tenantId, storeId: merchant.store.id });

  return (
    <>
      <SectionHeader title={t("new")} description={t("formDescription")} />
      {pages.length >= MAX_STORE_PAGES ? (
        <p className="text-sm text-muted-foreground">
          {t("limitReached")}{" "}
          <Link href={storePath(storeId, "/settings/pages")} className="underline underline-offset-4">
            {t("back")}
          </Link>
        </p>
      ) : (
        <PageForm
          initialValues={{ title: "", slug: "", content: "", status: "draft", metaTitle: "", metaDescription: "" }}
        />
      )}
    </>
  );
}
