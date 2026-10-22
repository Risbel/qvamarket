import { getTranslations, setRequestLocale } from "next-intl/server";
import { phoneCountryOptions } from "@/lib/countries";
import { splitPhone } from "@/lib/phone";
import { storeTimeZone } from "@/lib/date-range";
import { timeZoneOptions } from "@/lib/time-zones";
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
  const phoneCountry = profile?.phoneCountry ?? "";
  const phone = splitPhone(profile?.phone, phoneCountry);
  const whatsapp = splitPhone(profile?.whatsapp, phoneCountry);

  return (
    <>
      <SectionHeader title={t("title")} description={t("description")} />
      <PermissionFieldset permission={{ store: ["update"] }}>
        <StoreProfileForm
          countries={phoneCountryOptions(locale)}
          timeZones={timeZoneOptions()}
          initialValues={{
            description: profile?.description ?? "",
            phone: phone.national,
            phoneNumberCountry: phone.country,
            whatsapp: whatsapp.national,
            whatsappCountry: whatsapp.country,
            contactEmail: profile?.contactEmail ?? "",
            address: profile?.address ?? "",
            phoneCountry,
            timeZone: storeTimeZone(profile?.timeZone),
            metaTitle: profile?.metaTitle ?? "",
            metaDescription: profile?.metaDescription ?? "",
          }}
        />
      </PermissionFieldset>
    </>
  );
}
