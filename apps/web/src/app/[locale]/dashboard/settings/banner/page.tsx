import { getTranslations, setRequestLocale } from "next-intl/server";
import { listBannerImages } from "@/server/store-banner";
import { publicUrl } from "@/server/storage";
import { requireMerchantPermission } from "@/server/tenant";
import { SectionHeader } from "../section-header";
import { BannerImages } from "./banner-images";

export default async function BannerSettingsPage({
  params,
}: PageProps<"/[locale]/dashboard/settings/banner">) {
  const { locale } = await params;
  setRequestLocale(locale);

  const merchant = await requireMerchantPermission(locale, { store: ["update"] });
  const t = await getTranslations("Banner");
  const images = await listBannerImages({ tenantId: merchant.tenantId, storeId: merchant.store.id });

  return (
    <>
      <SectionHeader title={t("title")} description={t("description")} />
      <BannerImages
        images={images.map((image) => ({
          id: image.id,
          url: publicUrl(image.storageKey),
          sizeBytes: image.sizeBytes,
        }))}
      />
    </>
  );
}
