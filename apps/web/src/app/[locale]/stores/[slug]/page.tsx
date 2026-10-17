import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { listPublicCatalog } from "@/server/public-catalog";
import { BANNER_DEVICES } from "@/lib/images";
import {
  getPublicStoreBySlug,
  listPublicBannerImages,
  listPublicSecondaryBanner,
} from "@/server/public-store";
import { selectedCurrency } from "@/server/storefront-currency";
import { cn } from "@/lib/utils";
import { Spotlight, Spotlights } from "@/components/spotlight";
import { BannerCarousel } from "./banner-carousel";
import { BANNER_GAP } from "./banner-layout";
import { CategoryIndex } from "./category-index";
import { ProductCard } from "./product-card";

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
  // An empty wrapper would still take a gap in <main>, so it is only rendered with a hero
  const hasBanner = BANNER_DEVICES.some((device) => hero[device].length > 0);

  return (
    // `isolate` keeps the spotlights (-z-10) behind the page content without going under <body>
    <div className="relative isolate flex flex-1 flex-col">
      {/* Brand glows behind the top of the page (dark theme only) */}
      <Spotlights className="bottom-auto h-full">
        <Spotlight color="accent" size="40rem" opacity={0.3} className="-top-56 -right-48" />
        <Spotlight color="accent" size="36rem" opacity={0.2} className="top-80 -left-56" />
        <Spotlight color="accent" size="36rem" opacity={0.1} className="bottom-0 -right-56" />
      </Spotlights>
      {sections.length > 1 && (
        // Index of the categories, right under the header: jumps to each section of the page
        <CategoryIndex
          label={t("categoriesLabel")}
          sections={sections.map(({ id, title }) => ({ id, title }))}
        />
      )}
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-6">
        {hasBanner && (
          // Hero and secondary tiles in their own column, spaced like the two tiles of a pair
          // (BANNER_GAP), so the row under the hero sits at the same distance as the tiles
          <div className={cn("flex flex-col", BANNER_GAP)}>
            {/* One hero per screen size, each only where the merchant uploaded images for it */}
            {BANNER_DEVICES.map(
              (device) =>
                hero[device].length > 0 && (
                  <BannerCarousel
                    key={device}
                    kind="hero"
                    device={device}
                    slides={hero[device].map((image) => ({
                      id: image.id,
                      images: [image],
                    }))}
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
          </div>
        )}
        {products.length === 0 ? (
          <>
            <h1 className="text-2xl font-semibold">{t("title")}</h1>
            <p className="text-muted-foreground">{t("empty")}</p>
          </>
        ) : (
          <>
            <h1 className="sr-only">{store.name}</h1>
            {/* The bars stay shown during a jump from the index (holdBars), so the heading
                lands under all of them: header, phone search row, index */}
            {sections.map((section) => (
              <section
                key={section.id}
                id={section.id}
                aria-labelledby={`${section.id}-title`}
                className="flex scroll-mt-[calc(var(--store-header)+var(--store-search)+var(--store-index)+1rem)] flex-col gap-4 md:scroll-mt-[calc(var(--store-header)+var(--store-index)+1rem)]"
              >
                {/* first-letter: a category typed in lowercase ("ropa") still reads as a title */}
                <h2
                  id={`${section.id}-title`}
                  className="text-2xl font-semibold tracking-tight first-letter:uppercase md:text-3xl"
                >
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
                    />
                  ))}
                </ul>
              </section>
            ))}
          </>
        )}
      </main>
    </div>
  );
}
