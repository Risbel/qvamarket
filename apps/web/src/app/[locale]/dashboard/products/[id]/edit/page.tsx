import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { z } from "zod";
import { currencyDigits, minorToInput } from "@/lib/money";
import { listProductImages } from "@/server/product-images";
import { getProduct } from "@/server/products";
import { publicUrl } from "@/server/storage";
import { requireMerchantPermission } from "@/server/tenant";
import { ProductForm } from "../../product-form";
import { ProductImages } from "./product-images";

export default async function EditProductPage({
  params,
  searchParams,
}: PageProps<"/[locale]/dashboard/products/[id]/edit">) {
  const { locale, id } = await params;
  const { created } = await searchParams;
  setRequestLocale(locale);

  const merchant = await requireMerchantPermission(locale, { product: ["update"] });
  if (!z.uuid().safeParse(id).success) notFound();

  // Scoped by tenant and store: another company's product id is a 404
  const scope = { tenantId: merchant.tenantId, storeId: merchant.store.id };
  const product = await getProduct(scope, id);
  if (!product) notFound();
  const images = await listProductImages(scope, id);

  const digits = currencyDigits(merchant.store.currency);
  const t = await getTranslations("Products");

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-8 p-4">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">{t("edit")}</h1>
        {created && (
          <p role="status" className="rounded-md bg-muted p-3 text-sm">
            {t("createdNotice")}
          </p>
        )}
      </div>
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
      <ProductImages
        productId={product.id}
        productName={product.name}
        images={images.map((image) => ({
          id: image.id,
          url: publicUrl(image.storageKey),
          sizeBytes: image.sizeBytes,
        }))}
      />
    </main>
  );
}
