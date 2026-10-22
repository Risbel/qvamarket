import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, permanentRedirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ArrowLeftIcon, TagIcon } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { buildStoreUrl } from "@/lib/tenancy";
import { OG_SIZE, productOgVersion } from "@/server/product-og";
import { getPublicProduct, listRelatedProducts } from "@/server/public-catalog";
import { getPublicStoreBySlug } from "@/server/public-store";
import { publicUrl } from "@/server/storage";
import { selectedCurrency } from "@/server/storefront-currency";
import { FavoriteButton } from "../../favorite-button";
import { ProductCard } from "../../product-card";
import { ProductGallery } from "./product-gallery";
import { ShareButtons } from "./share-buttons";
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
  const { locale, slug, id } = await params;
  const found = await load(slug, id);
  if (!found) return {};
  const { store, currency, product } = found;
  const title = product.metaTitle ?? `${product.name} · ${store.name}`;
  const description = product.metaDescription ?? product.description?.slice(0, 160) ?? undefined;

  // Generated card (/api/og/product/...), priced in the store's default currency like the route
  const cardProduct =
    currency.code === store.defaultCurrency.code
      ? product
      : ((await getPublicProduct(store.id, product.slug, store.defaultCurrency.code)) ?? product);
  const origin = buildStoreUrl(store.slug, (await headers()).get("host"));
  const version = productOgVersion(store, cardProduct, locale);
  const image = {
    url: `${origin}/api/og/product/${encodeURIComponent(product.slug)}?locale=${locale}&v=${version}`,
    ...OG_SIZE,
    alt: product.name,
    type: "image/jpeg",
  };
  return {
    title,
    description,
    openGraph: { title, description, url: `${origin}/${locale}/products/${product.slug}`, siteName: store.name, images: [image] },
    twitter: { card: "summary_large_image", title, description, images: [image] },
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
  const related = await listRelatedProducts(found.store.id, currency.code, product.id);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-8">
      <nav aria-label={t("breadcrumb")}>
        <Link href="/" className={buttonVariants({ variant: "ghost", size: "sm", className: "-ml-2.5 text-muted-foreground" })}>
          <ArrowLeftIcon aria-hidden />
          {t("back")}
        </Link>
      </nav>

      <div className="grid gap-8 md:grid-cols-2">
        <ProductGallery images={product.imageKeys.map((key) => publicUrl(key))} alt={product.name} />

        <div className="flex flex-col gap-4">
          {product.category && (
            <Badge
              variant="secondary"
              render={<a href={`/${locale}#${product.category.slug}`} />}
              aria-label={t("category", { name: product.category.name })}
            >
              <TagIcon data-icon="inline-start" aria-hidden />
              {product.category.name}
            </Badge>
          )}
          <div className="-mt-2 flex items-start justify-between gap-3">
            <h1 className="text-3xl font-semibold leading-tight">{product.name}</h1>
            <FavoriteButton productId={product.id} productName={product.name} className="shrink-0" />
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

          <section className="flex flex-col gap-2 border-t pt-4" aria-labelledby="share-title">
            <h2 id="share-title" className="text-sm font-medium">
              {t("share.title")}
            </h2>
            <ShareButtons productName={product.name} />
          </section>
        </div>
      </div>

      {related.length > 0 && (
        <section className="flex flex-col gap-4 border-t pt-8" aria-labelledby="related-title">
          <h2 id="related-title" className="text-2xl font-semibold tracking-tight">
            {t("related")}
          </h2>
          {/* One full row of 5 from lg up; below it 2 or 4 columns, so the 5th card is left out */}
          <ul className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-5 max-lg:[&>li:nth-child(n+5)]:hidden">
            {related.map((item) => (
              <ProductCard key={item.id} product={item} currency={currency.code} locale={locale} eager={false} size="sm" />
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
