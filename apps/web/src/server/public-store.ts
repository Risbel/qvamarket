import { cache } from "react";
import { and, asc, db, eq, isNotNull, store, storeBannerImage, storePage, storeSecondaryBannerPair } from "@qvashop/db";
import { parseFooterLinks } from "@/lib/footer";
import type { BannerDevice } from "@/lib/images";
import { parseFooterSocial } from "@/lib/social";
import { getStoreSlug } from "@/lib/tenancy";
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
      logotypeKey: store.logotypeKey,
      primaryColor: store.primaryColor,
      accentColor: store.accentColor,
      themeRadius: store.themeRadius,
      themeBase: store.themeBase,
      themeTinted: store.themeTinted,
      secondaryBannerVisible: store.secondaryBannerVisible,
      footerLinks: store.footerLinks,
      footerText: store.footerText,
      footerSocial: store.footerSocial,
    })
    .from(store)
    .where(and(eq(store.slug, slug), eq(store.status, "active")))
    .limit(1);
  if (!row) return null;
  const currencies = (await getStoreCurrencies([row.id])).get(row.id) ?? [];
  const defaultCurrency = currencies.find((c) => c.isDefault) ?? currencies[0];
  if (!defaultCurrency) return null; // a store without currencies cannot sell anything
  // Re-checked on read too: only safe URLs reach an href
  return {
    ...row,
    footerLinks: parseFooterLinks(row.footerLinks),
    footerSocial: parseFooterSocial(row.footerSocial),
    currencies,
    defaultCurrency,
  };
});

/**
 * The store of the subdomain a request came to. Taken from the Host header, never from the
 * browser's input, so what a shopper does (account, favorites) is only ever attached to the
 * store it is done on (the session cookie is set for that host too).
 */
export async function getHostStore(requestHeaders: Headers) {
  const slug = getStoreSlug(requestHeaders.get("host"), process.env.ROOT_DOMAIN ?? "localhost");
  return slug ? getPublicStoreBySlug(slug) : null;
}

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

/**
 * Secondary banner of a store (pairs of tiles under the hero), one list per device, each in
 * display order, with COMPLETE pairs only (a pair missing a side is never shown). Same rules
 * as listPublicBannerImages; the caller also checks store.secondaryBannerVisible and that the
 * hero has images for that device.
 */
export const listPublicSecondaryBanner = cache(async (storeId: string) => {
  const pair = storeSecondaryBannerPair;
  const rows = await db
    .select({ id: pair.id, device: pair.device, left: pair.leftStorageKey, right: pair.rightStorageKey })
    .from(pair)
    .where(and(eq(pair.storeId, storeId), isNotNull(pair.leftStorageKey), isNotNull(pair.rightStorageKey)))
    .orderBy(asc(pair.position), asc(pair.createdAt));
  const banner: Record<BannerDevice, { id: string; images: { id: string; url: string }[] }[]> = {
    desktop: [],
    mobile: [],
  };
  for (const row of rows) {
    if (!row.left || !row.right) continue;
    banner[row.device as BannerDevice]?.push({
      id: row.id,
      images: [
        { id: `${row.id}-left`, url: publicUrl(row.left) },
        { id: `${row.id}-right`, url: publicUrl(row.right) },
      ],
    });
  }
  return banner;
});

/**
 * A PUBLISHED custom page of a store, by its slug (drafts do not exist for the public). Same
 * rules as the banners: only call it with the id of a store returned by getPublicStoreBySlug.
 */
export const getPublicStorePage = cache(async (storeId: string, slug: string) => {
  const [row] = await db
    .select({
      title: storePage.title,
      slug: storePage.slug,
      content: storePage.content,
      metaTitle: storePage.metaTitle,
      metaDescription: storePage.metaDescription,
    })
    .from(storePage)
    .where(and(eq(storePage.storeId, storeId), eq(storePage.slug, slug), eq(storePage.status, "published")))
    .limit(1);
  return row ?? null;
});
