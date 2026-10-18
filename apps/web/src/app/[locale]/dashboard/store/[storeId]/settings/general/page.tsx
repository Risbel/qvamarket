import { getTranslations, setRequestLocale } from "next-intl/server";
import { phoneCountryOptions } from "@/lib/countries";
import { getStoreProfile } from "@/server/store-settings";
import { requirePanelSection } from "@/server/tenant";
import { PermissionFieldset } from "@/components/permissions/permission-fieldset";
import { SectionHeader } from "../section-header";
import { StoreProfileForm } from "./store-profile-form";

export default async function GeneralSettingsPage({
  params,
}: PageProps<"/[locale]/dashboard/store/[storeId]/settings/general">) {
  const { locale, storeId } = await params;
  setRequestLocale(locale);

  const merchant = await requirePanelSection(locale, storeId, "settings");
  const t = await getTranslations("Settings.profile");
  const profile = await getStoreProfile({ tenantId: merchant.tenantId, storeId: merchant.store.id });

  return (
    <>
      <SectionHeader title={t("title")} description={t("description")} />
      <PermissionFieldset permission={{ store: ["update"] }}>
        <StoreProfileForm
          countries={phoneCountryOptions(locale)}
          initialValues={{
            description: profile?.description ?? "",
            phone: profile?.phone ?? "",
            whatsapp: profile?.whatsapp ?? "",
            contactEmail: profile?.contactEmail ?? "",
            address: profile?.address ?? "",
            phoneCountry: profile?.phoneCountry ?? "",
            metaTitle: profile?.metaTitle ?? "",
            metaDescription: profile?.metaDescription ?? "",
          }}
        />
      </PermissionFieldset>
    </>
  );
}
