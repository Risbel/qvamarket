// The customer's cart lives in the browser (localStorage, one per store) and holds ONLY
// variant ids and quantities (a simple product is sold through its default variant). Names, prices and stock are never stored here: the server
// re-reads them every time (src/server/cart.ts), so a tampered cart cannot change a price.

export const MAX_LINE_QUANTITY = 99;
export const MAX_CART_LINES = 50;

export type CartItem = { variantId: string; quantity: number };

// Same rule as zod's z.uuid() on the server: anything else is dropped here, so the browser
// never sends an id the server would refuse.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Reads whatever is in storage and keeps only what is valid: anything else (corrupt JSON,
 * wrong types, bad ids, quantities out of range, extra fields such as a "price") is dropped.
 * Duplicate products are merged and the size is capped.
 */
export function parseCart(raw: string | null): CartItem[] {
  if (!raw) return [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  return sanitizeCartItems(data);
}

/**
 * Same rules for an already parsed value (e.g. the items a Server Action receives): only
 * valid `{ variantId, quantity }` entries survive, merged and capped.
 */
export function sanitizeCartItems(data: unknown): CartItem[] {
  if (!Array.isArray(data)) return [];

  const merged = new Map<string, number>();
  // Bounded work even for a huge tampered array
  for (const entry of data.slice(0, MAX_CART_LINES * 2)) {
    if (typeof entry !== "object" || entry === null) continue;
    const { variantId, quantity } = entry as Record<string, unknown>;
    if (typeof variantId !== "string" || !UUID.test(variantId)) continue;
    if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 1) continue;
    const id = variantId.toLowerCase();
    merged.set(id, Math.min((merged.get(id) ?? 0) + quantity, MAX_LINE_QUANTITY));
    if (merged.size >= MAX_CART_LINES) break;
  }
  return [...merged].map(([variantId, quantity]) => ({ variantId, quantity }));
}

export function serializeCart(items: CartItem[]): string {
  return JSON.stringify(items.map(({ variantId, quantity }) => ({ variantId, quantity })));
}

/** Adds `quantity` of a product (merging with an existing line), up to `max` per line. */
export function addToCart(
  items: CartItem[],
  variantId: string,
  quantity: number,
  max: number = MAX_LINE_QUANTITY,
): CartItem[] {
  const limit = Math.min(max, MAX_LINE_QUANTITY);
  const existing = items.find((item) => item.variantId === variantId);
  if (!existing && items.length >= MAX_CART_LINES) return items;
  const next = Math.min((existing?.quantity ?? 0) + quantity, limit);
  if (next < 1) return items;
  return existing
    ? items.map((item) => (item.variantId === variantId ? { variantId, quantity: next } : item))
    : [...items, { variantId, quantity: next }];
}

export function setLineQuantity(items: CartItem[], variantId: string, quantity: number): CartItem[] {
  if (!Number.isInteger(quantity) || quantity < 1) return removeLine(items, variantId);
  return items.map((item) =>
    item.variantId === variantId
      ? { variantId, quantity: Math.min(quantity, MAX_LINE_QUANTITY) }
      : item,
  );
}

export function removeLine(items: CartItem[], variantId: string): CartItem[] {
  return items.filter((item) => item.variantId !== variantId);
}

export function cartCount(items: CartItem[]): number {
  return items.reduce((sum, item) => sum + item.quantity, 0);
}

// ---- browser storage + change notification (client only)

// v2: entries are variant ids (v1 carts held product ids and are simply ignored)
export const cartStorageKey = (storeId: string) => `qvashop:cart:v2:${storeId}`;

const listeners = new Set<() => void>();

export function subscribeCart(callback: () => void): () => void {
  listeners.add(callback);
  // "storage" fires when ANOTHER tab changes the cart; same-tab changes use `emit`
  window.addEventListener("storage", callback);
  return () => {
    listeners.delete(callback);
    window.removeEventListener("storage", callback);
  };
}

export function readCartRaw(storeId: string): string | null {
  try {
    return window.localStorage.getItem(cartStorageKey(storeId));
  } catch {
    return null; // storage blocked (private mode, disabled): the cart simply stays empty
  }
}

export function writeCart(storeId: string, items: CartItem[]): void {
  try {
    if (items.length === 0) window.localStorage.removeItem(cartStorageKey(storeId));
    else window.localStorage.setItem(cartStorageKey(storeId), serializeCart(items));
  } catch {
    // ignore: nothing else we can do without storage
  }
  listeners.forEach((callback) => callback());
}
