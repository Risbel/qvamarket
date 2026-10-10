import { getTranslations, setRequestLocale } from "next-intl/server";
import { DEFAULT_ACCENT, DEFAULT_PRIMARY } from "@/lib/color";
import { publicUrl } from "@/server/storage";
import { requireMerchantPermission } from "@/server/tenant";
import { BrandingForm } from "./branding-form";
import { LogoUploader } from "./logo-uploader";

export default async function BrandingPage({
  params,
}: PageProps<"/[locale]/dashboard/branding">) {
  const { locale } = await params;
  setRequestLocale(locale);

  const merchant = await requireMerchantPermission(locale, { store: ["update"] });
  const t = await getTranslations("Branding");
  const { store } = merchant;
  const logoUrl = store.logoKey ? publicUrl(store.logoKey) : null;

  return (
    <div className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-8 p-4">
      <div>
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
      </div>
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
  );
}
