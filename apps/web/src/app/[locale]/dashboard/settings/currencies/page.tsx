import { getTranslations, setRequestLocale } from "next-intl/server";
import { listActiveCurrencies } from "@/server/currencies";
import { requireMerchantPermission } from "@/server/tenant";
import { SectionHeader } from "../section-header";
import { CurrenciesForm } from "./currencies-form";

export default async function CurrenciesSettingsPage({
  params,
}: PageProps<"/[locale]/dashboard/settings/currencies">) {
  const { locale } = await params;
  setRequestLocale(locale);

  const merchant = await requireMerchantPermission(locale, { store: ["update"] });
  const t = await getTranslations("Settings.currencies");
  const available = await listActiveCurrencies();
  const names = new Intl.DisplayNames(locale, { type: "currency" });

  return (
    <>
      <SectionHeader title={t("title")} description={t("description")} />
      <CurrenciesForm
        initialValues={{
          currencies: merchant.store.currencies.map((c) => ({ code: c.code, rate: c.rate ?? "", roundingMinor: c.roundingMinor })),
          defaultCode: merchant.store.defaultCurrency.code,
          baseCode: merchant.store.baseCurrency.code,
        }}
        available={available.map((c) => ({ code: c.code, digits: c.digits, label: `${c.code} · ${names.of(c.code) ?? c.name}` }))}
      />
    </>
  );
}
