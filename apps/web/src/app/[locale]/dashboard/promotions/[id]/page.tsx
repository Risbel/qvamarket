import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { z } from "zod";
import { minorToInput } from "@/lib/money";
import { getPromotion, listPromotableProducts } from "@/server/promotions";
import { requireMerchantPermission } from "@/server/tenant";
import { PromotionForm } from "../promotion-form";

export default async function EditPromotionPage({ params }: PageProps<"/[locale]/dashboard/promotions/[id]">) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const merchant = await requireMerchantPermission(locale, { promotion: ["update"] });
  if (!z.uuid().safeParse(id).success) notFound();
  // Scoped by tenant and store: another company's promotion is a 404
  const scope = { tenantId: merchant.tenantId, storeId: merchant.store.id };
  const promotion = await getPromotion(scope, id);
  if (!promotion) notFound();
  const products = await listPromotableProducts(scope);
  const t = await getTranslations("Promotions");
  const currencies = merchant.store.currencies;

  // One form row per variant that has a promotion price, in catalog order
  const variantIds = [...new Set(promotion.prices.map((p) => p.variantId))];
  const ordered = products.flatMap((p) => p.variants.map((v) => v.id)).filter((vid) => variantIds.includes(vid));
  const items = ordered.map((variantId) => ({
    variantId,
    prices: currencies.map((c) => {
      const row = promotion.prices.find((p) => p.variantId === variantId && p.currencyCode === c.code);
      return { currency: c.code, price: row ? minorToInput(row.amountMinor, c.digits) : "" };
    }),
  }));

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-4">
      <h1 className="text-2xl font-semibold">{t("edit")}</h1>
      <PromotionForm
        promotionId={promotion.id}
        products={products}
        currencies={currencies}
        initialValues={{
          name: promotion.name,
          kind: promotion.kind as "sale" | "override",
          status: promotion.status as "draft" | "active",
          startsAt: promotion.startsAt?.toISOString() ?? "",
          endsAt: promotion.endsAt?.toISOString() ?? "",
          items,
        }}
      />
    </main>
  );
}
