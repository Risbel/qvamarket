import { getTranslations, setRequestLocale } from "next-intl/server";
import { DEFAULT_ACCENT, DEFAULT_PRIMARY } from "@/lib/color";
import {
  DEFAULT_THEME_BASE,
  DEFAULT_THEME_RADIUS,
  isThemeBase,
  isThemeRadius,
} from "@/lib/store-theme";
import { publicUrl } from "@/server/storage";
import { requirePanelSection } from "@/server/tenant";
import { PermissionFieldset } from "@/components/permissions/permission-fieldset";
import { SectionHeader } from "../section-header";
import { BrandingForm } from "./branding-form";
import { BrandImageUploader } from "./brand-image-uploader";

export default async function BrandingPage({
  params,
}: PageProps<"/[locale]/dashboard/store/[storeId]/settings/branding">) {
  const { locale, storeId } = await params;
  setRequestLocale(locale);

  const merchant = await requirePanelSection(locale, storeId, "settings");
  const t = await getTranslations("Branding");
  const { store } = merchant;
  const logoUrl = store.logoKey ? publicUrl(store.logoKey) : null;
  const logotypeUrl = store.logotypeKey ? publicUrl(store.logotypeKey) : null;

  return (
    <>
      <SectionHeader title={t("title")} description={t("description")} />
      <PermissionFieldset permission={{ store: ["update"] }}>
        <div className="flex flex-col gap-8">
          <BrandImageUploader kind="logo" imageUrl={logoUrl} storeName={store.name} />
          <BrandImageUploader kind="logotype" imageUrl={logotypeUrl} storeName={store.name} />
          <section className="flex flex-col gap-4" aria-labelledby="theme-title">
            <h2 id="theme-title" className="text-lg font-semibold">
              {t("theme.title")}
            </h2>
            <BrandingForm
              storeName={store.name}
              logoUrl={logoUrl}
              logotypeUrl={logotypeUrl}
              initialValues={{
                primaryColor: store.primaryColor ?? DEFAULT_PRIMARY,
                accentColor: store.accentColor ?? DEFAULT_ACCENT,
                radius: isThemeRadius(store.themeRadius) ? store.themeRadius : DEFAULT_THEME_RADIUS,
                base: isThemeBase(store.themeBase) ? store.themeBase : DEFAULT_THEME_BASE,
                tinted: store.themeTinted,
              }}
            />
          </section>
        </div>
      </PermissionFieldset>
    </>
  );
}
