import { getTranslations, setRequestLocale } from "next-intl/server";
import { phoneCountryOptions } from "@/lib/countries";
import { getStoreProfile } from "@/server/store-settings";
import { requirePanelSection } from "@/server/tenant";
import { SectionHeader } from "../section-header";
import { StoreProfileForm } from "./store-profile-form";

export default async function GeneralSettingsPage({
  params,
}: PageProps<"/[locale]/dashboard/settings/general">) {
  const { locale } = await params;
  setRequestLocale(locale);

  const merchant = await requirePanelSection(locale, "settings");
  const t = await getTranslations("Settings.profile");
  const profile = await getStoreProfile({ tenantId: merchant.tenantId, storeId: merchant.store.id });

  return (
    <>
      <SectionHeader title={t("title")} description={t("description")} />
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
    </>
  );
}
