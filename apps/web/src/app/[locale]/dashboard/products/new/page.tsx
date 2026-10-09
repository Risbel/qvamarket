import { getTranslations, setRequestLocale } from "next-intl/server";
import { currencyDigits } from "@/lib/money";
import { requireMerchantPermission } from "@/server/tenant";
import { ProductForm } from "../product-form";

export default async function NewProductPage({
  params,
}: PageProps<"/[locale]/dashboard/products/new">) {
  const { locale } = await params;
  setRequestLocale(locale);

  const merchant = await requireMerchantPermission(locale, { product: ["create"] });
  const t = await getTranslations("Products");

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 p-4">
      <h1 className="text-2xl font-semibold">{t("new")}</h1>
      <ProductForm
        currency={merchant.store.currency}
        currencyDigits={currencyDigits(merchant.store.currency)}
        initialValues={{
          name: "",
          description: "",
          price: "",
          stock: "",
          status: "draft",
        }}
      />
    </main>
  );
}
