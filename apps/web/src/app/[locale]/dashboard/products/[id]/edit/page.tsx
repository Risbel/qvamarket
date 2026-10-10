import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { z } from "zod";
import { listCategories } from "@/server/categories";
import { listProductImages } from "@/server/product-images";
import { getProduct } from "@/server/products";
import { publicUrl } from "@/server/storage";
import { requireMerchantPermission } from "@/server/tenant";
import { productToFormValues } from "../../form-values";
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
  const [images, categories] = await Promise.all([listProductImages(scope, id), listCategories(scope)]);
  const t = await getTranslations("Products");

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 p-4">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">{t("edit")}</h1>
        {created && (
          <p role="status" className="rounded-md bg-muted p-3 text-sm">
            {t("createdNotice")}
          </p>
        )}
      </div>
      {product.variantCount > 1 ? (
        // Products with options are edited by the variant editor (next step of the roadmap)
        <p className="rounded-md bg-muted p-3 text-sm">{t("hasVariantsNotice")}</p>
      ) : (
        <ProductForm
          productId={product.id}
          currencies={merchant.store.currencies}
          categories={categories.map((c) => ({ id: c.id, name: c.name }))}
          initialValues={productToFormValues(product, merchant.store.currencies)}
        />
      )}
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
