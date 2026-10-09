import type { CSSProperties } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import {
  DEFAULT_ACCENT,
  DEFAULT_PRIMARY,
  readableForeground,
} from "@/lib/color";
import { getPublicStoreBySlug } from "@/server/public-store";
import { publicUrl } from "@/server/storage";

export async function generateMetadata({
  params,
}: LayoutProps<"/[locale]/stores/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const store = await getPublicStoreBySlug(slug);
  return store ? { title: store.name } : {};
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

  const primary = store.primaryColor ?? DEFAULT_PRIMARY;
  const accent = store.accentColor ?? DEFAULT_ACCENT;
  const brand = {
    "--brand": primary,
    "--brand-foreground": readableForeground(primary),
    "--brand-accent": accent,
    "--brand-accent-foreground": readableForeground(accent),
  } as CSSProperties;

  return (
    <div className="flex flex-1 flex-col" style={brand}>
      <header
        style={{ backgroundColor: "var(--brand)", color: "var(--brand-foreground)" }}
      >
        <div className="mx-auto flex w-full max-w-5xl items-center gap-3 px-4 py-4">
          <Link href="/" className="flex items-center gap-3">
            {store.logoKey && (
              // eslint-disable-next-line @next/next/no-img-element -- our own bucket, already compressed
              <img
                src={publicUrl(store.logoKey)}
                alt=""
                width={40}
                height={40}
                className="size-10 rounded object-contain"
              />
            )}
            <span className="text-lg font-semibold">{store.name}</span>
          </Link>
        </div>
      </header>
      {children}
    </div>
  );
}
