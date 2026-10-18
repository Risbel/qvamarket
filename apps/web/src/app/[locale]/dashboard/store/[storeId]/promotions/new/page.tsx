import { getTranslations, setRequestLocale } from "next-intl/server";
import { listPromotableProducts } from "@/server/promotions";
import { requireMerchantPermission } from "@/server/tenant";
import { PromotionForm } from "../promotion-form";

export default async function NewPromotionPage({ params }: PageProps<"/[locale]/dashboard/store/[storeId]/promotions/new">) {
  const { locale, storeId } = await params;
  setRequestLocale(locale);

  const merchant = await requireMerchantPermission(locale, storeId, { promotion: ["create"] });
  const t = await getTranslations("Promotions");
  const products = await listPromotableProducts({ tenantId: merchant.tenantId, storeId: merchant.store.id });

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-4">
      <h1 className="text-2xl font-semibold">{t("new")}</h1>
      <PromotionForm
        products={products}
        currencies={merchant.store.currencies}
        initialValues={{ name: "", kind: "sale", status: "active", startsAt: "", endsAt: "", items: [] }}
      />
    </div>
  );
}
