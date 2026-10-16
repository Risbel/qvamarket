import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link, redirect } from "@/i18n/navigation";
import { auth } from "@/lib/auth";
import { ensureCustomer } from "@/server/customer-accounts";
import { listFavoriteIds } from "@/server/favorites";
import { listPublicProductsByIds } from "@/server/public-catalog";
import { getPublicStoreBySlug } from "@/server/public-store";
import { selectedCurrency } from "@/server/storefront-currency";
import { ProductCard } from "../../product-card";
import { FavoritesList, WhileFavorite } from "./favorites-list";

export async function generateMetadata() {
  const t = await getTranslations("Store.favorites");
  return { title: t("title"), robots: { index: false } };
}

/** The products the shopper marked with the heart on this store, newest first. */
export default async function AccountFavoritesPage({ params }: PageProps<"/[locale]/stores/[slug]/account/favorites">) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const store = await getPublicStoreBySlug(slug);
  if (!store) notFound();

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return redirect({ href: { pathname: "/login", query: { next: "/account/favorites" } }, locale });
  // Covers a session started without our sign-in (e.g. Better Auth's own endpoint)
  await ensureCustomer(store.id, session.user);

  const currency = await selectedCurrency(store.currencies);
  const [t, tAccount] = await Promise.all([getTranslations("Store.favorites"), getTranslations("Store.account")]);
  const products = await listPublicProductsByIds(store.id, currency.code, await listFavoriteIds(store.id, session.user.id));

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-8">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <FavoritesList ids={products.map((p) => p.id)} empty={<p className="text-muted-foreground">{t("empty")}</p>}>
        {products.map((product, index) => (
          <WhileFavorite key={product.id} productId={product.id}>
            <ProductCard product={product} currency={currency.code} locale={locale} eager={index < 4} />
          </WhileFavorite>
        ))}
      </FavoritesList>
      <p className="text-xs text-muted-foreground">{t("unavailableNote")}</p>
      <Link href="/" className="w-fit text-sm font-medium underline underline-offset-4">
        {tAccount("continueShopping")}
      </Link>
    </main>
  );
}
