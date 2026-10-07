import { getTranslations, setRequestLocale } from "next-intl/server";
import { MerchantForm } from "./merchant-form";

export default async function NewMerchantPage({
  params,
}: PageProps<"/[locale]/admin/merchants/new">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Admin");

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6">
      <h1 className="text-2xl font-semibold">{t("newMerchant")}</h1>
      <MerchantForm />
    </div>
  );
}
