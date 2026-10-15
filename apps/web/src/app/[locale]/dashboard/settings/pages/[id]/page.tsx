import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { z } from "zod";
import { getStorePage } from "@/server/store-pages";
import { requireMerchantPermission } from "@/server/tenant";
import { SectionHeader } from "../../section-header";
import { PageForm } from "../page-form";

export default async function EditStorePagePage({ params }: PageProps<"/[locale]/dashboard/settings/pages/[id]">) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const merchant = await requireMerchantPermission(locale, { store: ["update"] });
  if (!z.uuid().safeParse(id).success) notFound();
  // Scoped by tenant and store: another company's page is a 404
  const page = await getStorePage({ tenantId: merchant.tenantId, storeId: merchant.store.id }, id);
  if (!page) notFound();
  const t = await getTranslations("Settings.pages");

  return (
    <>
      <SectionHeader title={t("editTitle")} description={t("formDescription")} />
      <PageForm
        pageId={page.id}
        initialValues={{
          title: page.title,
          slug: page.slug,
          content: page.content,
          status: page.status === "published" ? "published" : "draft",
          metaTitle: page.metaTitle ?? "",
          metaDescription: page.metaDescription ?? "",
        }}
      />
    </>
  );
}
