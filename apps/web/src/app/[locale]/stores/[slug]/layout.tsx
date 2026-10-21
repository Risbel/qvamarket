import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { auth } from "@/lib/auth";
import { buildStoreTheme } from "@/lib/store-theme";
import { listFavoriteIds } from "@/server/favorites";
import { getPublicStoreBySlug } from "@/server/public-store";
import { publicUrl } from "@/server/storage";
import { selectedCurrency } from "@/server/storefront-currency";
import { ModeToggle } from "@/components/mode-toggle";
import { StoreThemeProvider } from "@/components/store-theme-provider";
import { AccountMenu } from "./account-menu";
import { CartLink } from "./cart-link";
import { CartProvider } from "./cart-provider";
import { CurrencySwitcher } from "./currency-switcher";
import { FavoritesProvider } from "./favorites-provider";
import { StoreFooter } from "./store-footer";
import { HeaderSearch, MobileSearchRow } from "./store-search";

export async function generateMetadata({
  params,
}: LayoutProps<"/[locale]/stores/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const store = await getPublicStoreBySlug(slug);
  return store
    ? { title: store.metaTitle ?? store.name, description: store.metaDescription ?? store.description ?? undefined }
    : {};
}

/**
 * Shell of every storefront page: resolves the store (unknown, pending and suspended
 * stores are a 404) and dresses the page in the store's generated theme (StoreThemeProvider:
 * the shadcn tokens plus --brand, --brand-foreground, --brand-accent, --brand-accent-foreground).
 */
export default async function StoreLayout({
  children,
  params,
}: LayoutProps<"/[locale]/stores/[slug]">) {
  const { locale, slug } = await params;
  setRequestLocale(locale);

  const store = await getPublicStoreBySlug(slug);
  if (!store) notFound();

  const currency = await selectedCurrency(store.currencies);
  // Host-only cookie: a session here is this store's alone
  const session = await auth.api.getSession({ headers: await headers() });
  const favoriteIds = session ? await listFavoriteIds(store.id, session.user.id) : [];
  const theme = buildStoreTheme({
    primary: store.primaryColor,
    accent: store.accentColor,
    radius: store.themeRadius,
    base: store.themeBase,
    tinted: store.themeTinted,
  });

  return (
    <StoreThemeProvider theme={theme}>
      <CartProvider storeId={store.id} storeSlug={store.slug} currency={currency.code}>
        <FavoritesProvider signedIn={session !== null} initialIds={favoriteIds}>
          {/* --store-header: the main bar's height; --store-search: the phone search row's;
              --store-index: the catalog's category index (under them, see category-index.tsx);
              --store-sticky: what is pinned at the top right now, for whatever sticks below it
              (the main bar alone from md up, where the search sits inside it, or while the
              phone row is scrolled away) */}
          <div
            className="flex flex-1 flex-col [--store-header:3.5rem] [--store-search:3rem] [--store-index:3rem] [--store-sticky:calc(var(--store-header)+var(--store-search))] has-[[data-search-hidden]]:[--store-sticky:var(--store-header)] md:[--store-sticky:var(--store-header)]"
          >
            <header
              // The brand color, slightly see-through, blurring what scrolls under it
              className="sticky top-0 z-40 bg-(--brand)/80 backdrop-blur-md backdrop-saturate-150"
              style={{ color: "var(--brand-foreground)" }}
            >
              <div className="mx-auto flex h-(--store-header) w-full max-w-5xl items-center gap-3 px-4">
                <Link href="/" className="flex min-w-0 items-center gap-3">
                  {store.logotypeKey ? (
                    // The logotype already carries the name: it replaces the logo + name. Wide
                    // images shrink to the room left by the header's buttons, never cropped.
                    // eslint-disable-next-line @next/next/no-img-element -- our own bucket, already compressed
                    <img
                      src={publicUrl(store.logotypeKey)}
                      alt={store.name}
                      className="h-10 w-auto max-w-full min-w-0 object-contain object-left sm:max-w-64"
                    />
                  ) : (
                    <>
                      {store.logoKey && (
                        // eslint-disable-next-line @next/next/no-img-element -- our own bucket, already compressed
                        <img
                          src={publicUrl(store.logoKey)}
                          alt=""
                          width={40}
                          height={40}
                          className="size-10 shrink-0 rounded object-contain"
                        />
                      )}
                      <span className="truncate text-lg font-semibold">{store.name}</span>
                    </>
                  )}
                </Link>
                <HeaderSearch storeName={store.name} />
                <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
                  {store.currencies.length > 1 && (
                    <CurrencySwitcher codes={store.currencies.map((c) => c.code)} current={currency.code} />
                  )}
                  <ModeToggle className="size-9 rounded-full hover:bg-current/15 hover:text-current focus-visible:border-transparent focus-visible:ring-2 focus-visible:ring-current dark:hover:bg-current/15 [&_svg:not([class*='size-'])]:size-5" />
                  <CartLink />
                  <AccountMenu
                    user={
                      session
                        ? { name: session.user.name, email: session.user.email, image: session.user.image ?? null }
                        : null
                    }
                  />
                </div>
              </div>
            </header>
            <MobileSearchRow storeName={store.name} />
            {children}
            <StoreFooter
              name={store.name}
              logoUrl={store.logoKey ? publicUrl(store.logoKey) : null}
              logotypeUrl={store.logotypeKey ? publicUrl(store.logotypeKey) : null}
              text={store.footerText}
              groups={store.footerLinks}
              social={store.footerSocial}
            />
          </div>
        </FavoritesProvider>
      </CartProvider>
    </StoreThemeProvider>
  );
}
