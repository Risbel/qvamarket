import { headers } from "next/headers";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { buildStoreUrl } from "@/lib/tenancy";
import { buttonVariants } from "@/components/ui/button";
import { mainImageKeys } from "@/server/product-images";
import { listProductPrices, listProducts } from "@/server/products";
import { publicUrl } from "@/server/storage";
import { requirePanelSection } from "@/server/tenant";
import { ProductsTable, type ProductRow } from "./products-table";

export default async function ProductsPage({
  params,
}: PageProps<"/[locale]/dashboard/products">) {
  const { locale } = await params;
  setRequestLocale(locale);

  const merchant = await requirePanelSection(locale, "products");
  const t = await getTranslations("Products");
  const scope = { tenantId: merchant.tenantId, storeId: merchant.store.id };
  const [products, prices] = await Promise.all([listProducts(scope), listProductPrices(scope)]);
  const mainImages = await mainImageKeys(
    scope,
    products.map((p) => p.id),
  );
  // Product links only work while the store is public
  const storeUrl =
    merchant.store.status === "active"
      ? buildStoreUrl(merchant.store.slug, (await headers()).get("host"))
      : null;

  const rows: ProductRow[] = products.map((p) => {
    const imageKey = mainImages.get(p.id);
    return {
      id: p.id,
      name: p.name,
      status: p.status as ProductRow["status"],
      categoryName: p.categoryName,
      prices: prices.get(p.id) ?? {},
      variantCount: p.variantCount,
      stock: p.stock,
      imageUrl: imageKey ? publicUrl(imageKey) : null,
      publicUrl:
        storeUrl && p.status === "active" ? `${storeUrl}/${locale}/products/${p.slug}` : null,
    };
  });

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 p-4">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        {merchant.can({ product: ["create"] }) && (
          <Link href="/dashboard/products/new" className={buttonVariants()}>
            {t("newButton")}
          </Link>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="text-muted-foreground">{t("empty")}</p>
      ) : (
        // What the member may do (the Server Actions check it again)
        <ProductsTable
          rows={rows}
          currencies={merchant.store.currencies}
        />
      )}
    </div>
  );
}
