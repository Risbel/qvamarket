import { notFound } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { z } from "zod";
import { Link } from "@/i18n/navigation";
import { buttonVariants } from "@/components/ui/button";
import { listCategories } from "@/server/categories";
import { listProductImages } from "@/server/product-images";
import { getProduct } from "@/server/products";
import { publicUrl } from "@/server/storage";
import { requireMerchantPermission } from "@/server/tenant";
import { getProductVariants } from "@/server/variants";
import { productToFormValues } from "../../form-values";
import { ProductForm } from "../../product-form";
import { OptionsEditor } from "./options-editor";
import { VariantsEditor } from "./variants-editor";

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
  const [images, categories, { options, variants }] = await Promise.all([
    listProductImages(scope, id),
    listCategories(scope),
    getProductVariants(scope, id),
  ]);
  const t = await getTranslations("Products");

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 p-4">
      <div className="flex flex-col gap-2">
        <Link
          href="/dashboard/products"
          className={buttonVariants({ variant: "ghost", size: "sm", className: "-ml-2.5 self-start text-muted-foreground" })}
        >
          <ArrowLeftIcon aria-hidden />
          {t("backToList")}
        </Link>
        <h1 className="text-2xl font-semibold">{t("edit")}</h1>
        {created && (
          <p role="status" className="rounded-md bg-muted p-3 text-sm">
            {t("createdNotice")}
          </p>
        )}
      </div>
      {/* Remounted when the product gains or loses options (its fields change) */}
      <ProductForm
        key={product.hasOptions ? "with-options" : "simple"}
        productId={product.id}
        simple={!product.hasOptions}
        currencies={merchant.store.currencies}
        categories={categories.map((c) => ({ id: c.id, name: c.name }))}
        initialValues={productToFormValues(
          product,
          merchant.store.currencies,
          images.map((image) => image.id),
        )}
        imageUrls={Object.fromEntries(images.map((image) => [image.id, publicUrl(image.storageKey)]))}
      />
      <OptionsEditor productId={product.id} options={options} />
      {product.hasOptions && (
        <VariantsEditor productId={product.id} variants={variants} currencies={merchant.store.currencies} />
      )}
    </div>
  );
}
