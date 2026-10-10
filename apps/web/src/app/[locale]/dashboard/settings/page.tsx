import { getTranslations, setRequestLocale } from "next-intl/server";
import { listActiveCurrencies } from "@/server/currencies";
import { getStoreProfile } from "@/server/store-settings";
import { requireMerchantPermission } from "@/server/tenant";
import { CurrenciesForm } from "./currencies-form";
import { StoreProfileForm } from "./store-profile-form";

export default async function SettingsPage({
  params,
}: PageProps<"/[locale]/dashboard/settings">) {
  const { locale } = await params;
  setRequestLocale(locale);

  const merchant = await requireMerchantPermission(locale, { store: ["update"] });
  const t = await getTranslations("Settings");
  const scope = { tenantId: merchant.tenantId, storeId: merchant.store.id };
  const [available, profile] = await Promise.all([listActiveCurrencies(), getStoreProfile(scope)]);
  const names = new Intl.DisplayNames(locale, { type: "currency" });

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-10 p-4">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>

      <section className="flex flex-col gap-3" aria-labelledby="currencies-title">
        <div>
          <h2 id="currencies-title" className="text-lg font-semibold">
            {t("currencies.title")}
          </h2>
          <p className="text-sm text-muted-foreground">{t("currencies.description")}</p>
        </div>
        <CurrenciesForm
          enabled={merchant.store.currencies.map((c) => c.code)}
          defaultCode={merchant.store.defaultCurrency.code}
          available={available.map((c) => ({ code: c.code, label: `${c.code} · ${names.of(c.code) ?? c.name}` }))}
        />
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="profile-title">
        <div>
          <h2 id="profile-title" className="text-lg font-semibold">
            {t("profile.title")}
          </h2>
          <p className="text-sm text-muted-foreground">{t("profile.description")}</p>
        </div>
        <StoreProfileForm
          initialValues={{
            description: profile?.description ?? "",
            phone: profile?.phone ?? "",
            whatsapp: profile?.whatsapp ?? "",
            contactEmail: profile?.contactEmail ?? "",
            address: profile?.address ?? "",
            pickupInstructions: profile?.pickupInstructions ?? "",
            metaTitle: profile?.metaTitle ?? "",
            metaDescription: profile?.metaDescription ?? "",
          }}
        />
      </section>
    </main>
  );
}
