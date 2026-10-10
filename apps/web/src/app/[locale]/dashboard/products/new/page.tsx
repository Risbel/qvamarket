import { getTranslations, setRequestLocale } from "next-intl/server";
import { listCategories } from "@/server/categories";
import { requireMerchantPermission } from "@/server/tenant";
import { emptyProductValues } from "../form-values";
import { ProductForm } from "../product-form";

export default async function NewProductPage({
  params,
}: PageProps<"/[locale]/dashboard/products/new">) {
  const { locale } = await params;
  setRequestLocale(locale);

  const merchant = await requireMerchantPermission(locale, { product: ["create"] });
  const t = await getTranslations("Products");
  const categories = await listCategories({ tenantId: merchant.tenantId, storeId: merchant.store.id });

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-4">
      <h1 className="text-2xl font-semibold">{t("new")}</h1>
      <ProductForm
        currencies={merchant.store.currencies}
        categories={categories.map((c) => ({ id: c.id, name: c.name }))}
        initialValues={emptyProductValues(merchant.store.currencies)}
      />
    </div>
  );
}
