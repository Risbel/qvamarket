"use client";

import type { ReactNode } from "react";
import { useFavorites } from "../../favorites-provider";

/**
 * The grid of the favorites page: cards (rendered on the server) disappear as soon as their
 * heart is turned off, and the empty text shows when none is left.
 */
export function FavoritesList({ ids, empty, children }: { ids: string[]; empty: ReactNode; children: ReactNode }) {
  const { isFavorite } = useFavorites();
  if (!ids.some(isFavorite)) return empty;
  return <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">{children}</ul>;
}

/** One card of the list, hidden once it is no longer a favorite. */
export function WhileFavorite({ productId, children }: { productId: string; children: ReactNode }) {
  const { isFavorite } = useFavorites();
  return isFavorite(productId) ? children : null;
}
