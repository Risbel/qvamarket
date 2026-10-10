"use server";

import { headers } from "next/headers";
import { sanitizeCartItems } from "@/lib/cart";
import { priceCart, type PricedLine } from "./cart";
import { getPublicStoreBySlug } from "./public-store";
import { createRateLimiter } from "./rate-limit";
import { clientIp } from "./request";
import { publicUrl } from "./storage";
import { pickCurrency } from "./storefront-currency";

// Public and read-only, but it hits the database: limit it per IP.
const limiter = createRateLimiter({ limit: 120, windowMs: 60 * 1000 });

/** A priced line as the browser receives it: image as a public URL, no storage keys. */
export type CartLineView = Omit<PricedLine, "imageKey"> & { imageUrl: string | null };

export type PriceCartActionResult =
  | { ok: true; currency: string; lines: CartLineView[]; subtotalMinor: number }
  | { ok: false; error: "invalid" | "notFound" | "tooManyRequests" };

/**
 * Current prices, stock and totals for the shopper's cart. The slug only says WHICH public
 * store to read (it is looked up, not trusted); the currency must be one of the store's
 * (otherwise its default is used); the items are re-validated; no price or name comes from
 * the client.
 */
export async function priceCartAction(
  slug: unknown,
  currency: unknown,
  items: unknown,
): Promise<PriceCartActionResult> {
  if (!limiter.tryConsume(clientIp(await headers()))) {
    return { ok: false, error: "tooManyRequests" };
  }
  if (typeof slug !== "string" || !Array.isArray(items)) return { ok: false, error: "invalid" };

  const store = await getPublicStoreBySlug(slug);
  if (!store) return { ok: false, error: "notFound" };
  const chosen = pickCurrency(store.currencies, typeof currency === "string" ? currency : null);

  // A broken entry (tampered or corrupt storage) is skipped; it must not break the whole cart
  const cart = await priceCart(store.id, chosen.code, sanitizeCartItems(items));
  return {
    ok: true,
    currency: cart.currency,
    subtotalMinor: cart.subtotalMinor,
    lines: cart.lines.map(({ imageKey, ...line }) => ({
      ...line,
      imageUrl: imageKey ? publicUrl(imageKey) : null,
    })),
  };
}
