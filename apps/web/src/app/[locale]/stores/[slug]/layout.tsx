import type { CSSProperties } from "react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { auth } from "@/lib/auth";
import {
  DEFAULT_ACCENT,
  DEFAULT_PRIMARY,
  readableForeground,
} from "@/lib/color";
import { getPublicStoreBySlug } from "@/server/public-store";
import { publicUrl } from "@/server/storage";
import { selectedCurrency } from "@/server/storefront-currency";
import { AccountMenu } from "./account-menu";
import { CartLink } from "./cart-link";
import { CartProvider } from "./cart-provider";
import { CurrencySwitcher } from "./currency-switcher";

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
 * stores are a 404) and dresses the page in the store's brand. Components below use the
 * CSS variables --brand, --brand-foreground, --brand-accent, --brand-accent-foreground.
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
  const primary = store.primaryColor ?? DEFAULT_PRIMARY;
  const accent = store.accentColor ?? DEFAULT_ACCENT;
  const brand = {
    "--brand": primary,
    "--brand-foreground": readableForeground(primary),
    "--brand-accent": accent,
    "--brand-accent-foreground": readableForeground(accent),
  } as CSSProperties;

  return (
    <CartProvider storeId={store.id} storeSlug={store.slug} currency={currency.code}>
      {/* --store-header: the header's height, for whatever sticks or scrolls below it */}
      <div className="flex flex-1 flex-col [--store-header:3.5rem]" style={brand}>
        <header
          // The brand color, slightly see-through, blurring what scrolls under it
          className="sticky top-0 z-40 bg-(--brand)/80 backdrop-blur-md backdrop-saturate-150"
          style={{ color: "var(--brand-foreground)" }}
        >
          <div className="mx-auto flex h-(--store-header) w-full max-w-5xl items-center gap-3 px-4">
            <Link href="/" className="flex min-w-0 items-center gap-3">
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
            </Link>
            <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
              {store.currencies.length > 1 && (
                <CurrencySwitcher codes={store.currencies.map((c) => c.code)} current={currency.code} />
              )}
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
        {children}
      </div>
    </CartProvider>
  );
}
