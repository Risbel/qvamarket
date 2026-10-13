import { getTranslations, setRequestLocale } from "next-intl/server";
import { BANNER_DEVICES } from "@/lib/images";
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
      <div className="flex flex-col gap-10">
        {BANNER_DEVICES.map((device) => (
          <BannerImages
            key={device}
            device={device}
            images={images
              .filter((image) => image.device === device)
              .map((image) => ({
                id: image.id,
                url: publicUrl(image.storageKey),
                sizeBytes: image.sizeBytes,
              }))}
          />
        ))}
      </div>
    </>
  );
}
