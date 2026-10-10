import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { z } from "zod";
import { Link } from "@/i18n/navigation";
import { formatMoney } from "@/lib/money";
import { getPublicProduct } from "@/server/public-catalog";
import { getPublicStoreBySlug } from "@/server/public-store";
import { publicUrl } from "@/server/storage";
import { AddToCart } from "./add-to-cart";
import { ProductGallery } from "./product-gallery";

/** Only low stock is worth showing to a customer. */
const LOW_STOCK = 5;

async function loadProduct(slug: string, id: string) {
  const store = await getPublicStoreBySlug(slug);
  if (!store || !z.uuid().safeParse(id).success) return null;
  const product = await getPublicProduct(store.id, id);
  return product ? { store, product } : null;
}

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/stores/[slug]/products/[id]">): Promise<Metadata> {
  const { slug, id } = await params;
  const found = await loadProduct(slug, id);
  if (!found) return {};
  const { store, product } = found;
  return {
    title: `${product.name} · ${store.name}`,
    description: product.description?.slice(0, 160) ?? undefined,
    openGraph: product.imageKeys[0] ? { images: [publicUrl(product.imageKeys[0])] } : undefined,
  };
}

export default async function StoreProductPage({
  params,
}: PageProps<"/[locale]/stores/[slug]/products/[id]">) {
  const { locale, slug, id } = await params;
  setRequestLocale(locale);

  // Unknown, draft, archived, or another store's product: 404
  const found = await loadProduct(slug, id);
  if (!found) notFound();
  const { store, product } = found;
  const t = await getTranslations("Store.product");

  const soldOut = product.stock === 0;
  const lowStock = product.stock !== null && product.stock > 0 && product.stock <= LOW_STOCK;

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-8">
      <Link
        href="/"
        className="w-fit text-sm text-muted-foreground underline-offset-4 hover:underline"
      >
        ← {t("back")}
      </Link>

      <div className="grid gap-8 md:grid-cols-2">
        <ProductGallery
          images={product.imageKeys.map((key) => publicUrl(key))}
          alt={product.name}
        />

        <div className="flex flex-col gap-4">
          <h1 className="text-3xl font-semibold leading-tight">{product.name}</h1>
          <p className="text-2xl">{formatMoney(product.priceMinor, store.currency, locale)}</p>

          {soldOut && (
            <span
              className="w-fit rounded-full px-3 py-1 text-sm font-medium"
              style={{
                backgroundColor: "var(--brand-accent)",
                color: "var(--brand-accent-foreground)",
              }}
            >
              {t("soldOut")}
            </span>
          )}
          {lowStock && (
            <p className="text-sm text-muted-foreground">{t("lowStock", { count: product.stock! })}</p>
          )}

          {!soldOut && <AddToCart productId={product.id} stock={product.stock} />}

          {product.description && (
            // Plain text from the merchant: React escapes it; line breaks are kept
            <p className="whitespace-pre-line text-muted-foreground">{product.description}</p>
          )}
        </div>
      </div>
    </main>
  );
}
