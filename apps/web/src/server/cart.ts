import { MAX_LINE_QUANTITY, type CartItem } from "@/lib/cart";
import { getPublicProductsByIds } from "./public-catalog";

export type PricedLine = {
  productId: string;
  name: string | null;
  imageKey: string | null;
  /** price today, read from the database */
  unitPriceMinor: number;
  /** quantity the customer asked for */
  requestedQuantity: number;
  /** quantity that can actually be bought now (stock and per-line limit applied) */
  quantity: number;
  /** most the customer can take of this product right now */
  maxQuantity: number;
  lineTotalMinor: number;
  /**
   * ok: as requested · reduced: asked for more than available, quantity lowered ·
   * soldOut: stock is 0 · unavailable: no longer sold in this store (hidden, deleted, ...)
   */
  status: "ok" | "reduced" | "soldOut" | "unavailable";
};

export type PricedCart = {
  lines: PricedLine[];
  /** sum of the buyable lines, computed here and never taken from the client */
  subtotalMinor: number;
};

/**
 * Prices a cart (ids + quantities from the browser) with today's data from the database.
 * The client sends no prices and none would be trusted: this function is the only source
 * of a cart's amounts, and checkout must use it again. Integer minor units throughout.
 * (A cart can reach 50 lines x 99 x 10 000 000: orders must store totals as bigint.)
 */
export async function priceCart(storeId: string, items: CartItem[]): Promise<PricedCart> {
  const products = await getPublicProductsByIds(
    storeId,
    items.map((item) => item.productId),
  );

  const lines = items.map((item): PricedLine => {
    const found = products.get(item.productId);
    if (!found) {
      return {
        productId: item.productId,
        name: null,
        imageKey: null,
        unitPriceMinor: 0,
        requestedQuantity: item.quantity,
        quantity: 0,
        maxQuantity: 0,
        lineTotalMinor: 0,
        status: "unavailable",
      };
    }

    const maxQuantity = found.stock === null ? MAX_LINE_QUANTITY : Math.min(found.stock, MAX_LINE_QUANTITY);
    const quantity = Math.min(item.quantity, maxQuantity);
    return {
      productId: found.id,
      name: found.name,
      imageKey: found.imageKey,
      unitPriceMinor: found.priceMinor,
      requestedQuantity: item.quantity,
      quantity,
      maxQuantity,
      lineTotalMinor: found.priceMinor * quantity,
      status: maxQuantity === 0 ? "soldOut" : quantity < item.quantity ? "reduced" : "ok",
    };
  });

  return {
    lines,
    subtotalMinor: lines.reduce((sum, line) => sum + line.lineTotalMinor, 0),
  };
}
