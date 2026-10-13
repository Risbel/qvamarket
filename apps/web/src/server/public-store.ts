import { cache } from "react";
import { and, asc, db, eq, store, storeBannerImage } from "@qvashop/db";
import type { BannerDevice } from "@/lib/images";
import { getStoreCurrencies } from "./currencies";
import { publicUrl } from "./storage";

/**
 * Public view of a store for the storefront, found by its globally unique subdomain slug.
 * This is the one place that reads a store WITHOUT a tenant filter, because the visitor
 * is anonymous and the slug is the key. It therefore returns only public fields (never
 * tenant_id) and only for APPROVED stores (status "active"): pending and suspended stores
 * do not exist for the public. Products are read through public-catalog.ts with the same
 * rules; everything else uses requireMerchant()'s tenantId.
 *
 * Cached per request: the storefront layout and its pages all need the store.
 */
export const getPublicStoreBySlug = cache(async (slug: string) => {
  const [row] = await db
    .select({
      id: store.id,
      name: store.name,
      slug: store.slug,
      description: store.description,
      phone: store.phone,
      whatsapp: store.whatsapp,
      contactEmail: store.contactEmail,
      address: store.address,
      phoneCountry: store.phoneCountry,
      pickupInstructions: store.pickupInstructions,
      metaTitle: store.metaTitle,
      metaDescription: store.metaDescription,
      logoKey: store.logoKey,
      primaryColor: store.primaryColor,
      accentColor: store.accentColor,
    })
    .from(store)
    .where(and(eq(store.slug, slug), eq(store.status, "active")))
    .limit(1);
  if (!row) return null;
  const currencies = (await getStoreCurrencies([row.id])).get(row.id) ?? [];
  const defaultCurrency = currencies.find((c) => c.isDefault) ?? currencies[0];
  if (!defaultCurrency) return null; // a store without currencies cannot sell anything
  return { ...row, currencies, defaultCurrency };
});

/**
 * Hero banner images of a store, one list per device, each in display order. Only call it
 * with the id of a store returned by getPublicStoreBySlug (so an active one). Returns public
 * URLs only.
 */
export const listPublicBannerImages = cache(async (storeId: string) => {
  const rows = await db
    .select({ id: storeBannerImage.id, device: storeBannerImage.device, storageKey: storeBannerImage.storageKey })
    .from(storeBannerImage)
    .where(eq(storeBannerImage.storeId, storeId))
    .orderBy(asc(storeBannerImage.position), asc(storeBannerImage.createdAt));
  const banner: Record<BannerDevice, { id: string; url: string }[]> = { desktop: [], mobile: [] };
  for (const row of rows) {
    banner[row.device as BannerDevice]?.push({ id: row.id, url: publicUrl(row.storageKey) });
  }
  return banner;
});
