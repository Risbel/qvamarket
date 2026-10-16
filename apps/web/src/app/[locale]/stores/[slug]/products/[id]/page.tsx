import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getPublicProduct } from "@/server/public-catalog";
import { getPublicStoreBySlug } from "@/server/public-store";
import { publicUrl } from "@/server/storage";
import { selectedCurrency } from "@/server/storefront-currency";
import { FavoriteButton } from "../../favorite-button";
import { ProductGallery } from "./product-gallery";
import { VariantPurchase } from "./variant-purchase";

// The route segment is called [id] but holds the product's slug (old links by id still work
// and are redirected to the slug URL).
async function load(slug: string, key: string) {
  const store = await getPublicStoreBySlug(slug);
  if (!store) return null;
  const currency = await selectedCurrency(store.currencies);
  const product = await getPublicProduct(store.id, key, currency.code);
  return product ? { store, currency, product } : null;
}

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/stores/[slug]/products/[id]">): Promise<Metadata> {
  const { slug, id } = await params;
  const found = await load(slug, id);
  if (!found) return {};
  const { store, product } = found;
  return {
    title: product.metaTitle ?? `${product.name} · ${store.name}`,
    description: product.metaDescription ?? product.description?.slice(0, 160) ?? undefined,
    openGraph: product.imageKeys[0] ? { images: [publicUrl(product.imageKeys[0])] } : undefined,
  };
}

export default async function StoreProductPage({
  params,
  searchParams,
}: PageProps<"/[locale]/stores/[slug]/products/[id]">) {
  const { locale, slug, id } = await params;
  const { variant: variantParam } = await searchParams;
  setRequestLocale(locale);

  // Unknown, draft, archived, or another store's product: 404
  const found = await load(slug, id);
  if (!found) notFound();
  const { currency, product } = found;
  if (id !== product.slug) permanentRedirect(`/${locale}/products/${product.slug}`);
  const t = await getTranslations("Store.product");

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-8">
      <nav className="flex gap-2 text-sm text-muted-foreground" aria-label={t("breadcrumb")}>
        <Link href="/" className="underline-offset-4 hover:underline">
          ← {t("back")}
        </Link>
        {product.category && (
          <>
            <span aria-hidden>/</span>
            <a href={`/${locale}#${product.category.slug}`} className="underline-offset-4 hover:underline">
              {product.category.name}
            </a>
          </>
        )}
      </nav>

      <div className="grid gap-8 md:grid-cols-2">
        <ProductGallery images={product.imageKeys.map((key) => publicUrl(key))} alt={product.name} />

        <div className="flex flex-col gap-4">
          <div className="flex items-start justify-between gap-3">
            <h1 className="text-3xl font-semibold leading-tight">{product.name}</h1>
            <FavoriteButton productId={product.id} productName={product.name} className="shrink-0 border" />
          </div>

          <VariantPurchase
            options={product.options}
            variants={product.variants}
            currency={currency.code}
            locale={locale}
            initialVariantId={typeof variantParam === "string" ? variantParam : undefined}
          />

          {product.description && (
            // Plain text from the merchant: React escapes it; line breaks are kept
            <p className="whitespace-pre-line text-muted-foreground">{product.description}</p>
          )}
        </div>
      </div>
    </main>
  );
}
