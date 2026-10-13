import { getTranslations, setRequestLocale } from "next-intl/server";
import { getDeliverySettings } from "@/server/delivery-settings";
import { requireMerchantPermission } from "@/server/tenant";
import { SectionHeader } from "../section-header";
import { DeliveryAreaForm } from "./delivery-area-form";

export default async function DeliverySettingsPage({ params }: PageProps<"/[locale]/dashboard/settings/delivery">) {
  const { locale } = await params;
  setRequestLocale(locale);

  const merchant = await requireMerchantPermission(locale, { store: ["update"] });
  const t = await getTranslations("Settings.delivery");
  const settings = await getDeliverySettings({ tenantId: merchant.tenantId, storeId: merchant.store.id });

  return (
    <>
      <SectionHeader title={t("title")} description={t("description")} />
      <DeliveryAreaForm initialValues={settings} />
    </>
  );
}
