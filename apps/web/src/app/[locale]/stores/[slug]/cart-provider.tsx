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
  items: CartItem[];
  /** total number of units */
  count: number;
  add: (productId: string, quantity: number, max?: number) => void;
  setQuantity: (productId: string, quantity: number) => void;
  remove: (productId: string) => void;
};

const CartContext = createContext<CartContextValue | null>(null);

/**
 * The customer's cart for ONE store (stored in localStorage under the store id; every
 * subdomain is its own browser origin anyway). Holds ids and quantities only: see lib/cart.ts.
 */
export function CartProvider({
  storeId,
  storeSlug,
  children,
}: {
  storeId: string;
  storeSlug: string;
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
      items,
      count: cartCount(items),
      add: (productId, quantity, max) => update((current) => addToCart(current, productId, quantity, max)),
      setQuantity: (productId, quantity) => update((current) => setLineQuantity(current, productId, quantity)),
      remove: (productId) => update((current) => removeLine(current, productId)),
    }),
    [items, storeSlug, update],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const value = useContext(CartContext);
  if (!value) throw new Error("useCart must be used inside <CartProvider>");
  return value;
}
