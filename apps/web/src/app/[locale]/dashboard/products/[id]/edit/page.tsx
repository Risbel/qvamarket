import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { z } from "zod";
import { currencyDigits, minorToInput } from "@/lib/money";
import { getProduct } from "@/server/products";
import { requireMerchantPermission } from "@/server/tenant";
import { ProductForm } from "../../product-form";

export default async function EditProductPage({
  params,
}: PageProps<"/[locale]/dashboard/products/[id]/edit">) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const merchant = await requireMerchantPermission(locale, { product: ["update"] });
  if (!z.uuid().safeParse(id).success) notFound();

  // Scoped by tenant and store: another company's product id is a 404
  const product = await getProduct(
    { tenantId: merchant.tenantId, storeId: merchant.store.id },
    id,
  );
  if (!product) notFound();

  const digits = currencyDigits(merchant.store.currency);
  const t = await getTranslations("Products");

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 p-4">
      <h1 className="text-2xl font-semibold">{t("edit")}</h1>
      <ProductForm
        productId={product.id}
        currency={merchant.store.currency}
        currencyDigits={digits}
        initialValues={{
          name: product.name,
          description: product.description ?? "",
          price: minorToInput(product.priceMinor, digits),
          stock: product.stock === null ? "" : String(product.stock),
          status: product.status as "draft" | "active" | "archived",
        }}
      />
    </main>
  );
}
