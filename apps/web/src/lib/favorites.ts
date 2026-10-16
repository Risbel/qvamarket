// Favorite products: shared by the server (limit) and the storefront (pending favorite).

/** Most favorites a customer can keep on one store. */
export const MAX_FAVORITES = 200;

// A guest who clicks a heart is sent to sign in; the product waits here (this store's origin,
// this tab) and is saved once they come back signed in. Older than this = forgotten, so a
// sign-in much later does not add a product the shopper no longer thinks about.
const PENDING_KEY = "qvashop:pending-favorite";
const PENDING_MAX_AGE_MS = 30 * 60 * 1000;

export function savePendingFavorite(productId: string): void {
  try {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify({ productId, at: Date.now() }));
  } catch {
    // storage blocked: the shopper just clicks the heart again after signing in
  }
}

/** The product waiting to be saved (removed from storage), or null. */
export function takePendingFavorite(): string | null {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(PENDING_KEY);
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return null;
    const { productId, at } = value as { productId?: unknown; at?: unknown };
    if (typeof productId !== "string" || typeof at !== "number" || Date.now() - at > PENDING_MAX_AGE_MS) return null;
    return productId;
  } catch {
    return null;
  }
}
