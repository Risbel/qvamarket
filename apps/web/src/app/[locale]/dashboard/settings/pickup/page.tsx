import { getTranslations, setRequestLocale } from "next-intl/server";
import { getStoreProfile } from "@/server/store-settings";
import { requireMerchantPermission } from "@/server/tenant";
import { SectionHeader } from "../section-header";
import { PickupForm } from "./pickup-form";

export default async function PickupSettingsPage({
  params,
}: PageProps<"/[locale]/dashboard/settings/pickup">) {
  const { locale } = await params;
  setRequestLocale(locale);

  const merchant = await requireMerchantPermission(locale, { store: ["update"] });
  const t = await getTranslations("Settings.pickup");
  const profile = await getStoreProfile({ tenantId: merchant.tenantId, storeId: merchant.store.id });

  return (
    <>
      <SectionHeader title={t("title")} description={t("description")} />
      <PickupForm initialValues={{ pickupInstructions: profile?.pickupInstructions ?? "" }} />
    </>
  );
}
