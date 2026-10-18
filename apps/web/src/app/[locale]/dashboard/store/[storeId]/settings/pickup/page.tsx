import { getTranslations, setRequestLocale } from "next-intl/server";
import { getStoreProfile } from "@/server/store-settings";
import { requirePanelSection } from "@/server/tenant";
import { PermissionFieldset } from "@/components/permissions/permission-fieldset";
import { SectionHeader } from "../section-header";
import { PickupForm } from "./pickup-form";

export default async function PickupSettingsPage({
  params,
}: PageProps<"/[locale]/dashboard/store/[storeId]/settings/pickup">) {
  const { locale, storeId } = await params;
  setRequestLocale(locale);

  const merchant = await requirePanelSection(locale, storeId, "settings");
  const t = await getTranslations("Settings.pickup");
  const profile = await getStoreProfile({ tenantId: merchant.tenantId, storeId: merchant.store.id });

  return (
    <>
      <SectionHeader title={t("title")} description={t("description")} />
      <PermissionFieldset permission={{ store: ["update"] }}>
        <PickupForm initialValues={{ pickupInstructions: profile?.pickupInstructions ?? "" }} />
      </PermissionFieldset>
    </>
  );
}
