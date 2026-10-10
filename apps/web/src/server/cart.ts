import { MAX_LINE_QUANTITY, type CartItem } from "@/lib/cart";
import { resolvePrice } from "@/lib/pricing";
import { loadPriceRows } from "./pricing";
import { getPublicVariants } from "./public-catalog";

export type PricedLine = {
  variantId: string;
  productSlug: string | null;
  name: string | null;
  /** variant label, e.g. "M / Rojo" (null for a simple product) */
  variantTitle: string | null;
  imageKey: string | null;
  /** unit price for THIS quantity today (volume tiers and promotions applied) */
  unitPriceMinor: number;
  /** "was" price per unit, when there is one */
  compareAtMinor: number | null;
  /** quantity the customer asked for */
  requestedQuantity: number;
  /** quantity that can actually be bought now (stock and per-line limit applied) */
  quantity: number;
  /** most the customer can take of this variant right now */
  maxQuantity: number;
  lineTotalMinor: number;
  /**
   * ok: as requested · reduced: asked for more than available, quantity lowered ·
   * soldOut: stock is 0 · unavailable: not sold any more, or not in this currency
   */
  status: "ok" | "reduced" | "soldOut" | "unavailable";
};

export type PricedCart = {
  currency: string;
  lines: PricedLine[];
  /** sum of the buyable lines, computed here and never taken from the client */
  subtotalMinor: number;
};

/**
 * Prices a cart (variant ids + quantities from the browser) in one currency with today's data.
 * The client sends no prices and none would be trusted: this is the only source of a cart's
 * amounts, and checkout must use it again. Integer minor units throughout (orders: bigint).
 */
export async function priceCart(storeId: string, currencyCode: string, items: CartItem[]): Promise<PricedCart> {
  const ids = items.map((item) => item.variantId);
  const variants = await getPublicVariants(storeId, ids);
  const prices = await loadPriceRows(storeId, [...variants.keys()], currencyCode);

  const lines = items.map((item): PricedLine => {
    const variant = variants.get(item.variantId);
    const unavailable: PricedLine = {
      variantId: item.variantId,
      productSlug: null,
      name: null,
      variantTitle: null,
      imageKey: null,
      unitPriceMinor: 0,
      compareAtMinor: null,
      requestedQuantity: item.quantity,
      quantity: 0,
      maxQuantity: 0,
      lineTotalMinor: 0,
      status: "unavailable",
    };
    if (!variant) return unavailable;

    const maxQuantity = variant.stock === null ? MAX_LINE_QUANTITY : Math.min(variant.stock, MAX_LINE_QUANTITY);
    const quantity = Math.min(item.quantity, maxQuantity);
    // The unit price depends on the quantity (volume tiers)
    const price = resolvePrice(prices.get(variant.id) ?? [], Math.max(quantity, 1));
    if (!price) return { ...unavailable, productSlug: variant.productSlug, name: variant.name, variantTitle: variant.title, imageKey: variant.imageKey };

    return {
      variantId: variant.id,
      productSlug: variant.productSlug,
      name: variant.name,
      variantTitle: variant.title,
      imageKey: variant.imageKey,
      unitPriceMinor: price.unitMinor,
      compareAtMinor: price.compareAtMinor,
      requestedQuantity: item.quantity,
      quantity,
      maxQuantity,
      lineTotalMinor: price.unitMinor * quantity,
      status: maxQuantity === 0 ? "soldOut" : quantity < item.quantity ? "reduced" : "ok",
    };
  });

  return {
    currency: currencyCode,
    lines,
    subtotalMinor: lines.reduce((sum, line) => sum + line.lineTotalMinor, 0),
  };
}
