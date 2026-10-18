import { getTranslations, setRequestLocale } from "next-intl/server";
import { getFooterSettings } from "@/server/store-settings";
import { requirePanelSection } from "@/server/tenant";
import { PermissionFieldset } from "@/components/permissions/permission-fieldset";
import { SectionHeader } from "../section-header";
import { FooterLinksForm } from "./footer-links-form";
import { FooterSocialForm } from "./footer-social-form";
import { FooterTabs } from "./footer-tabs";
import { FooterTextForm } from "./footer-text-form";
import { FOOTER_TABS } from "./tabs";

export default async function FooterSettingsPage({
  params,
  searchParams,
}: PageProps<"/[locale]/dashboard/store/[storeId]/settings/footer">) {
  const { locale, storeId } = await params;
  setRequestLocale(locale);

  const merchant = await requirePanelSection(locale, storeId, "settings");
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
        about={
          <PermissionFieldset permission={{ store: ["update"] }}>
            <FooterTextForm initialValues={{ footerText: footer.text }} />
          </PermissionFieldset>
        }
        links={
          <PermissionFieldset permission={{ store: ["update"] }}>
            <FooterLinksForm initialValues={{ groups: footer.groups }} />
          </PermissionFieldset>
        }
        social={
          <PermissionFieldset permission={{ store: ["update"] }}>
            <FooterSocialForm initialValues={{ links: footer.social }} />
          </PermissionFieldset>
        }
      />
    </>
  );
}
