import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { PageContent } from "@/components/page-content";
import { pageContentText } from "@/lib/store-pages";
import { URL_SLUG } from "@/lib/validation/product";
import { getPublicStorePage, getPublicStoreBySlug } from "@/server/public-store";

// Custom page of the store: <store>/<locale>/<page-slug>. The storefront's own routes
// (products, cart, ...) are static segments, so they win; their names are also reserved slugs.
async function load(slug: string, pageSlug: string) {
  if (!URL_SLUG.test(pageSlug)) return null;
  const store = await getPublicStoreBySlug(slug);
  if (!store) return null;
  const page = await getPublicStorePage(store.id, pageSlug);
  return page ? { store, page } : null;
}

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/stores/[slug]/[pageSlug]">): Promise<Metadata> {
  const { slug, pageSlug } = await params;
  const found = await load(slug, pageSlug);
  if (!found) return {};
  const { store, page } = found;
  return {
    title: page.metaTitle ?? `${page.title} · ${store.name}`,
    description: page.metaDescription ?? (pageContentText(page.content).slice(0, 160) || undefined),
  };
}

export default async function StoreCustomPage({ params }: PageProps<"/[locale]/stores/[slug]/[pageSlug]">) {
  const { locale, slug, pageSlug } = await params;
  setRequestLocale(locale);

  // Unknown, draft, or another store's page: 404
  const found = await load(slug, pageSlug);
  if (!found) notFound();
  const { page } = found;

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-8">
      <h1 className="text-3xl font-semibold leading-tight">{page.title}</h1>
      <PageContent content={page.content} />
    </main>
  );
}
