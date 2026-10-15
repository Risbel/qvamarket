import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { SEARCH_QUERY_MAX } from "@/lib/search";
import { searchPublicCatalog } from "@/server/public-catalog";
import { getPublicStoreBySlug } from "@/server/public-store";
import { selectedCurrency } from "@/server/storefront-currency";
import { ProductCard } from "../product-card";

function queryOf(value: string | string[] | undefined): string {
  return (typeof value === "string" ? value : "").trim().slice(0, SEARCH_QUERY_MAX);
}

export async function generateMetadata({
  searchParams,
}: PageProps<"/[locale]/stores/[slug]/search">): Promise<Metadata> {
  const t = await getTranslations("Store.search");
  const q = queryOf((await searchParams).q);
  // Result pages are endless variations of the catalog: keep them out of search engines
  return { title: q ? t("titleFor", { q }) : t("title"), robots: { index: false } };
}

/** Search results: <store>/<locale>/search?q=... (the field is in the store header). */
export default async function StoreSearchPage({
  params,
  searchParams,
}: PageProps<"/[locale]/stores/[slug]/search">) {
  const { locale, slug } = await params;
  setRequestLocale(locale);

  const store = await getPublicStoreBySlug(slug);
  if (!store) notFound();
  const currency = await selectedCurrency(store.currencies);
  const q = queryOf((await searchParams).q);
  const [t, tc] = await Promise.all([getTranslations("Store.search"), getTranslations("Store.catalog")]);
  const results = q ? await searchPublicCatalog(store.id, currency.code, q) : [];

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{q ? t("titleFor", { q }) : t("title")}</h1>
        {q && results.length > 0 && (
          <p className="text-sm text-muted-foreground" role="status">
            {t("count", { count: results.length })}
          </p>
        )}
      </div>

      {!q ? (
        <p className="text-muted-foreground">{t("hint")}</p>
      ) : results.length === 0 ? (
        <div className="flex flex-col items-start gap-3" role="status">
          <p className="text-muted-foreground">{t("noResults")}</p>
          <Link href="/" className="text-sm font-medium underline underline-offset-4">
            {t("seeAll")}
          </Link>
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {results.map((product, index) => (
            <ProductCard
              key={product.id}
              product={product}
              currency={currency.code}
              locale={locale}
              eager={index < 4}
              labels={{ soldOut: tc("soldOut"), noImage: tc("noImage"), from: tc("from"), sale: tc("sale"), was: tc("was") }}
            />
          ))}
        </ul>
      )}
    </main>
  );
}
