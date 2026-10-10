import { getTranslations, setRequestLocale } from "next-intl/server";
import { DEFAULT_ACCENT, DEFAULT_PRIMARY } from "@/lib/color";
import { publicUrl } from "@/server/storage";
import { requireMerchantPermission } from "@/server/tenant";
import { SectionHeader } from "../section-header";
import { BrandingForm } from "./branding-form";
import { LogoUploader } from "./logo-uploader";

export default async function BrandingPage({
  params,
}: PageProps<"/[locale]/dashboard/settings/branding">) {
  const { locale } = await params;
  setRequestLocale(locale);

  const merchant = await requireMerchantPermission(locale, { store: ["update"] });
  const t = await getTranslations("Branding");
  const { store } = merchant;
  const logoUrl = store.logoKey ? publicUrl(store.logoKey) : null;

  return (
    <>
      <SectionHeader title={t("title")} description={t("description")} />
      <div className="flex flex-col gap-8">
        <LogoUploader logoUrl={logoUrl} storeName={store.name} />
        <section className="flex flex-col gap-4" aria-labelledby="colors-title">
          <h2 id="colors-title" className="text-lg font-semibold">
            {t("colors.title")}
          </h2>
          <BrandingForm
            storeName={store.name}
            logoUrl={logoUrl}
            initialValues={{
              primaryColor: store.primaryColor ?? DEFAULT_PRIMARY,
              accentColor: store.accentColor ?? DEFAULT_ACCENT,
            }}
          />
        </section>
      </div>
    </>
  );
}
