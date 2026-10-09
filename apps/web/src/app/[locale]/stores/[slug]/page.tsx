import type { CSSProperties } from "react";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import {
  DEFAULT_ACCENT,
  DEFAULT_PRIMARY,
  readableForeground,
} from "@/lib/color";
import { getPublicStoreBySlug } from "@/server/public-store";
import { publicUrl } from "@/server/storage";

export default async function StorePage({
  params,
}: PageProps<"/[locale]/stores/[slug]">) {
  const { locale, slug } = await params;
  setRequestLocale(locale);

  // Unknown or inactive store: 404 (the slug is only a routing key, not trusted data)
  const store = await getPublicStoreBySlug(slug);
  if (!store) notFound();
  const t = await getTranslations("Store");

  const primary = store.primaryColor ?? DEFAULT_PRIMARY;
  const accent = store.accentColor ?? DEFAULT_ACCENT;
  // The store's brand as CSS variables: storefront components use var(--brand) and friends
  const brand = {
    "--brand": primary,
    "--brand-foreground": readableForeground(primary),
    "--brand-accent": accent,
    "--brand-accent-foreground": readableForeground(accent),
  } as CSSProperties;

  return (
    <div className="flex flex-1 flex-col" style={brand}>
      <header
        className="flex items-center gap-3 px-6 py-4"
        style={{ backgroundColor: "var(--brand)", color: "var(--brand-foreground)" }}
      >
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
      </header>
      <main className="flex flex-1 items-center justify-center">
        <h1 className="text-3xl font-semibold">{t("hello", { slug })}</h1>
      </main>
    </div>
  );
}
