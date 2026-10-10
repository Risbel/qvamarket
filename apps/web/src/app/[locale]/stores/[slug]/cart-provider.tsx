"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  addToCart,
  cartCount,
  parseCart,
  readCartRaw,
  removeLine,
  setLineQuantity,
  subscribeCart,
  writeCart,
  type CartItem,
} from "@/lib/cart";

type CartContextValue = {
  storeSlug: string;
  /** the shopper's currency (validated by the server against the store's currencies) */
  currency: string;
  items: CartItem[];
  /** total number of units */
  count: number;
  add: (variantId: string, quantity: number, max?: number) => void;
  setQuantity: (variantId: string, quantity: number) => void;
  remove: (variantId: string) => void;
  /** empties the cart (after an order is placed) */
  clear: () => void;
};

const CartContext = createContext<CartContextValue | null>(null);

/**
 * The customer's cart for ONE store (stored in localStorage under the store id; every
 * subdomain is its own browser origin anyway). Holds ids and quantities only: see lib/cart.ts.
 */
export function CartProvider({
  storeId,
  storeSlug,
  currency,
  children,
}: {
  storeId: string;
  storeSlug: string;
  currency: string;
  children: ReactNode;
}) {
  // The raw string is the snapshot (stable between renders); the server renders an empty cart
  const raw = useSyncExternalStore(
    subscribeCart,
    () => readCartRaw(storeId),
    () => null,
  );
  const items = useMemo(() => parseCart(raw), [raw]);

  // Always start from what is in storage right now (another tab may have changed it)
  const update = useCallback(
    (change: (current: CartItem[]) => CartItem[]) =>
      writeCart(storeId, change(parseCart(readCartRaw(storeId)))),
    [storeId],
  );

  const value = useMemo<CartContextValue>(
    () => ({
      storeSlug,
      currency,
      items,
      count: cartCount(items),
      add: (variantId, quantity, max) => update((current) => addToCart(current, variantId, quantity, max)),
      setQuantity: (variantId, quantity) => update((current) => setLineQuantity(current, variantId, quantity)),
      remove: (variantId) => update((current) => removeLine(current, variantId)),
      clear: () => update(() => []),
    }),
    [items, storeSlug, currency, update],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const value = useContext(CartContext);
  if (!value) throw new Error("useCart must be used inside <CartProvider>");
  return value;
}
