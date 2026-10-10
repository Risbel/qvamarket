import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { formatMoney } from "@/lib/money";
import { PriceTag } from "@/components/price-tag";
import { getPublicProduct } from "@/server/public-catalog";
import { getPublicStoreBySlug } from "@/server/public-store";
import { publicUrl } from "@/server/storage";
import { selectedCurrency } from "@/server/storefront-currency";
import { AddToCart } from "./add-to-cart";
import { ProductGallery } from "./product-gallery";

/** Only low stock is worth showing to a customer. */
const LOW_STOCK = 5;

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
}: PageProps<"/[locale]/stores/[slug]/products/[id]">) {
  const { locale, slug, id } = await params;
  setRequestLocale(locale);

  // Unknown, draft, archived, or another store's product: 404
  const found = await load(slug, id);
  if (!found) notFound();
  const { currency, product } = found;
  if (id !== product.slug) permanentRedirect(`/${locale}/products/${product.slug}`);
  const t = await getTranslations("Store.product");

  // Simple products have one (default) variant; the variant picker comes with variants
  const variant = product.variants.find((v) => v.isDefault) ?? product.variants[0];
  const price = variant?.price ?? null;
  const soldOut = variant?.stock === 0;
  const lowStock = variant?.stock != null && variant.stock > 0 && variant.stock <= LOW_STOCK;

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
          <h1 className="text-3xl font-semibold leading-tight">{product.name}</h1>

          {price ? (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <PriceTag
                  unitMinor={price.unitMinor}
                  compareAtMinor={price.compareAtMinor}
                  currency={currency.code}
                  locale={locale}
                  size="lg"
                  wasLabel={t("was")}
                />
                {(soldOut || price.compareAtMinor !== null) && (
                  <span
                    className="rounded-full px-3 py-1 text-sm font-medium"
                    style={{ backgroundColor: "var(--brand-accent)", color: "var(--brand-accent-foreground)" }}
                  >
                    {soldOut ? t("soldOut") : t("sale")}
                  </span>
                )}
              </div>

              {variant && variant.tiers.length > 0 && (
                <div className="rounded-lg border p-3 text-sm" data-testid="volume-tiers">
                  <p className="mb-1 font-medium">{t("tiersTitle")}</p>
                  <ul className="flex flex-col gap-0.5 text-muted-foreground">
                    {variant.tiers.map((tier) => (
                      <li key={tier.minQuantity}>
                        {t("tierLine", {
                          count: tier.minQuantity,
                          price: formatMoney(tier.unitMinor, currency.code, locale),
                        })}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {lowStock && <p className="text-sm text-muted-foreground">{t("lowStock", { count: variant!.stock! })}</p>}
              {!soldOut && variant && <AddToCart variantId={variant.id} stock={variant.stock} />}
            </>
          ) : (
            <p className="rounded-md bg-muted p-3 text-sm">{t("notInCurrency", { currency: currency.code })}</p>
          )}

          {product.description && (
            // Plain text from the merchant: React escapes it; line breaks are kept
            <p className="whitespace-pre-line text-muted-foreground">{product.description}</p>
          )}
        </div>
      </div>
    </main>
  );
}
