import { and, db, eq, store } from "@qvashop/db";

/**
 * Public view of a store for the storefront, found by its globally unique subdomain slug.
 * This is the one place that reads tenant data WITHOUT a tenant filter, because the visitor
 * is anonymous and the slug is the key. It therefore returns only public fields (never
 * tenant_id) and only for APPROVED stores (status "active"): pending and suspended stores
 * do not exist for the public. Everything else uses requireMerchant()'s tenantId.
 */
export async function getPublicStoreBySlug(slug: string) {
  const [row] = await db
    .select({
      id: store.id,
      name: store.name,
      slug: store.slug,
      currency: store.currency,
      logoKey: store.logoKey,
      primaryColor: store.primaryColor,
      accentColor: store.accentColor,
    })
    .from(store)
    .where(and(eq(store.slug, slug), eq(store.status, "active")))
    .limit(1);
  return row ?? null;
}
