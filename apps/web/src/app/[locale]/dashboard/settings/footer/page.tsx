import { getTranslations, setRequestLocale } from "next-intl/server";
import { getFooterSettings } from "@/server/store-settings";
import { requireMerchantPermission } from "@/server/tenant";
import { SectionHeader } from "../section-header";
import { FooterLinksForm } from "./footer-links-form";
import { FooterSocialForm } from "./footer-social-form";
import { FooterTabs } from "./footer-tabs";
import { FooterTextForm } from "./footer-text-form";
import { FOOTER_TABS } from "./tabs";

export default async function FooterSettingsPage({
  params,
  searchParams,
}: PageProps<"/[locale]/dashboard/settings/footer">) {
  const { locale } = await params;
  setRequestLocale(locale);

  const merchant = await requireMerchantPermission(locale, { store: ["update"] });
  const [t, footer, { tab }] = await Promise.all([
    getTranslations("Settings.footer"),
    getFooterSettings({ tenantId: merchant.tenantId, storeId: merchant.store.id }),
    searchParams,
  ]);

  return (
    <>
      <SectionHeader title={t("title")} description={t("description")} />
      <FooterTabs
        defaultTab={FOOTER_TABS.find((value) => value === tab) ?? "about"}
        about={<FooterTextForm initialValues={{ footerText: footer.text }} />}
        links={<FooterLinksForm initialValues={{ groups: footer.groups }} />}
        social={<FooterSocialForm initialValues={{ links: footer.social }} />}
      />
    </>
  );
}
