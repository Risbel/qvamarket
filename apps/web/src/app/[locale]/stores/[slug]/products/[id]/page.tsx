import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ArrowLeftIcon, TagIcon } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { getPublicProduct } from "@/server/public-catalog";
import { getPublicStoreBySlug } from "@/server/public-store";
import { publicUrl } from "@/server/storage";
import { selectedCurrency } from "@/server/storefront-currency";
import { FavoriteButton } from "../../favorite-button";
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
    </main>
  );
}
