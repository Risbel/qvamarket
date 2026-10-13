import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { PriceTag } from "@/components/price-tag";
import { listPublicCatalog, type PublicListItem } from "@/server/public-catalog";
import { BANNER_DEVICES } from "@/lib/images";
import { getPublicStoreBySlug, listPublicBannerImages, listPublicSecondaryBanner } from "@/server/public-store";
import { publicUrl } from "@/server/storage";
import { selectedCurrency } from "@/server/storefront-currency";
import { BannerCarousel } from "./banner-carousel";

export default async function StoreCatalogPage({
  params,
}: PageProps<"/[locale]/stores/[slug]">) {
  const { locale, slug } = await params;
  setRequestLocale(locale);

  const store = await getPublicStoreBySlug(slug);
  if (!store) notFound();
  const currency = await selectedCurrency(store.currencies);
  const t = await getTranslations("Store.catalog");
  const [{ categories, products }, hero, secondary] = await Promise.all([
    listPublicCatalog(store.id, currency.code),
    listPublicBannerImages(store.id),
    listPublicSecondaryBanner(store.id),
  ]);

  // One section per visible category (in the merchant's order), then everything else
  const known = new Set(categories.map((c) => c.id));
  const sections = [
    ...categories.map((c) => ({
      id: c.slug,
      title: c.name,
      items: products.filter((p) => p.categoryId === c.id),
    })),
    {
      // "_" never appears in a slug, so this anchor cannot collide with a category
      id: "_otros",
      title: categories.length > 0 ? t("other") : t("title"),
      items: products.filter((p) => !p.categoryId || !known.has(p.categoryId)),
    },
  ].filter((section) => section.items.length > 0);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-8">
      {/* One hero per screen size, each only where the merchant uploaded images for it */}
      {BANNER_DEVICES.map(
        (device) =>
          hero[device].length > 0 && (
            <BannerCarousel
              key={device}
              kind="hero"
              device={device}
              slides={hero[device].map((image) => ({ id: image.id, images: [image] }))}
              storeName={store.name}
            />
          ),
      )}
      {/* The secondary banner (pairs of tiles) only sits under a hero on the same screen size,
          and only while the merchant has it switched on */}
      {store.secondaryBannerVisible &&
        BANNER_DEVICES.map(
          (device) =>
            hero[device].length > 0 &&
            secondary[device].length > 0 && (
              <BannerCarousel
                key={device}
                kind="secondary"
                device={device}
                slides={secondary[device]}
                storeName={store.name}
              />
            ),
        )}
      {products.length === 0 ? (
        <>
          <h1 className="text-2xl font-semibold">{t("title")}</h1>
          <p className="text-muted-foreground">{t("empty")}</p>
        </>
      ) : (
        <>
          <h1 className="sr-only">{store.name}</h1>
          {sections.length > 1 && (
            // Index of the categories: jumps to each section of the page
            <nav
              aria-label={t("categoriesLabel")}
              className="sticky top-(--store-header) z-10 -mx-4 flex gap-2 overflow-x-auto border-b bg-background/95 px-4 py-3 backdrop-blur"
            >
              {sections.map((section) => (
                <a
                  key={section.id}
                  href={`#${section.id}`}
                  className="shrink-0 rounded-full border px-3 py-1 text-sm hover:bg-muted"
                >
                  {section.title}
                </a>
              ))}
            </nav>
          )}

          {sections.map((section) => (
            <section key={section.id} id={section.id} aria-labelledby={`${section.id}-title`} className="flex scroll-mt-[calc(var(--store-header)+5rem)] flex-col gap-4">
              <h2 id={`${section.id}-title`} className="text-xl font-semibold">
                {section.title}
              </h2>
              <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                {section.items.map((product, index) => (
                  <ProductCard
                    key={product.id}
                    product={product}
                    currency={currency.code}
                    locale={locale}
                    eager={index < 4}
                    labels={{ soldOut: t("soldOut"), noImage: t("noImage"), from: t("from"), sale: t("sale"), was: t("was") }}
                  />
                ))}
              </ul>
            </section>
          ))}
        </>
      )}
    </main>
  );
}

function ProductCard({
  product,
  currency,
  locale,
  eager,
  labels,
}: {
  product: PublicListItem;
  currency: string;
  locale: string;
  eager: boolean;
  labels: { soldOut: string; noImage: string; from: string; sale: string; was: string };
}) {
  const badge = product.soldOut ? labels.soldOut : product.price.promotion || product.price.compareAtMinor ? labels.sale : null;
  return (
    <li>
      <Link
        href={`/products/${product.slug}`}
        className="group flex flex-col gap-2 rounded-lg outline-offset-4 focus-visible:outline-2"
      >
        <div className="relative aspect-square overflow-hidden rounded-lg border bg-muted">
          {product.imageKey ? (
            // eslint-disable-next-line @next/next/no-img-element -- our own bucket, already compressed
            <img
              src={publicUrl(product.imageKey)}
              alt={product.name}
              width={400}
              height={400}
              loading={eager ? "eager" : "lazy"}
              className={`size-full object-cover transition-transform group-hover:scale-105 ${product.soldOut ? "opacity-60" : ""}`}
            />
          ) : (
            <div className="flex size-full items-center justify-center text-xs text-muted-foreground">{labels.noImage}</div>
          )}
          {badge && (
            <span
              className="absolute left-2 top-2 rounded-full px-2.5 py-0.5 text-xs font-medium"
              style={{ backgroundColor: "var(--brand-accent)", color: "var(--brand-accent-foreground)" }}
            >
              {badge}
            </span>
          )}
        </div>
        <div className="flex flex-col">
          <span className="font-medium leading-snug">{product.name}</span>
          <PriceTag
            unitMinor={product.price.unitMinor}
            compareAtMinor={product.price.compareAtMinor}
            currency={currency}
            locale={locale}
            prefix={product.priceVaries ? labels.from : undefined}
            wasLabel={labels.was}
          />
        </div>
      </Link>
    </li>
  );
}
