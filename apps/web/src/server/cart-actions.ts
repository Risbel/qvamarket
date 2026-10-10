"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { MAX_CART_LINES, MAX_LINE_QUANTITY } from "@/lib/cart";
import { priceCart, type PricedLine } from "./cart";
import { getPublicStoreBySlug } from "./public-store";
import { createRateLimiter } from "./rate-limit";
import { clientIp } from "./request";
import { publicUrl } from "./storage";

// Public and read-only, but it hits the database: limit it per IP.
const limiter = createRateLimiter({ limit: 120, windowMs: 60 * 1000 });

const entrySchema = z.object({
  productId: z.uuid(),
  quantity: z.number().int().min(1).max(MAX_LINE_QUANTITY),
});

/** A priced line as the browser receives it: image as a public URL, no storage keys. */
export type CartLineView = Omit<PricedLine, "imageKey"> & { imageUrl: string | null };

export type PriceCartActionResult =
  | { ok: true; currency: string; lines: CartLineView[]; subtotalMinor: number }
  | { ok: false; error: "invalid" | "notFound" | "tooManyRequests" };

/**
 * Current prices, stock and totals for the customer's cart. The slug only says WHICH public
 * store to read (it is looked up, not trusted); the items are re-validated; no price or
 * name comes from the client.
 */
export async function priceCartAction(
  slug: unknown,
  items: unknown,
): Promise<PriceCartActionResult> {
  if (!limiter.tryConsume(clientIp(await headers()))) {
    return { ok: false, error: "tooManyRequests" };
  }

  if (typeof slug !== "string" || !Array.isArray(items)) return { ok: false, error: "invalid" };

  const store = await getPublicStoreBySlug(slug);
  if (!store) return { ok: false, error: "notFound" };

  // Merge duplicates the same way the client does
  const merged = new Map<string, number>();
  // A broken entry (tampered or corrupt storage) is skipped; it must not break the whole cart
  const entries = items.slice(0, MAX_CART_LINES * 2).flatMap((entry) => {
    const parsed = entrySchema.safeParse(entry);
    return parsed.success ? [parsed.data] : [];
  });
  for (const { productId, quantity } of entries) {
    const id = productId.toLowerCase();
    merged.set(id, Math.min((merged.get(id) ?? 0) + quantity, MAX_LINE_QUANTITY));
  }

  const cart = await priceCart(
    store.id,
    [...merged].map(([productId, quantity]) => ({ productId, quantity })),
  );
  return {
    ok: true,
    currency: store.currency,
    subtotalMinor: cart.subtotalMinor,
    lines: cart.lines.map(({ imageKey, ...line }) => ({
      ...line,
      imageUrl: imageKey ? publicUrl(imageKey) : null,
    })),
  };
}
