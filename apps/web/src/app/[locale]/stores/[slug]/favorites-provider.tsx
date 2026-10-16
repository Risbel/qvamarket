"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useRouter } from "@/i18n/navigation";
import { MAX_FAVORITES, takePendingFavorite } from "@/lib/favorites";
import { setFavoriteAction, type SetFavoriteResult } from "@/server/favorite-actions";

type FavoritesContextValue = {
  signedIn: boolean;
  isFavorite: (productId: string) => boolean;
  /** marks / unmarks right away and saves; reverts with an error toast if the server refuses */
  setFavorite: (productId: string, favorite: boolean) => Promise<void>;
};

const FavoritesContext = createContext<FavoritesContextValue | null>(null);

function withFavorite(ids: ReadonlySet<string>, productId: string, favorite: boolean): Set<string> {
  const next = new Set(ids);
  if (favorite) next.add(productId);
  else next.delete(productId);
  return next;
}

/**
 * The signed-in shopper's favorite products on this store (`initialIds` from the server; empty
 * for guests). Also saves the product a guest clicked before signing in (see lib/favorites.ts).
 */
export function FavoritesProvider({
  signedIn,
  initialIds,
  children,
}: {
  signedIn: boolean;
  initialIds: string[];
  children: ReactNode;
}) {
  const t = useTranslations("Store.favorites");
  const router = useRouter();
  const [ids, setIds] = useState<ReadonlySet<string>>(() => new Set(initialIds));
  // A server render after sign-in / sign-out (router.refresh) brings a new list: adopt it
  const serverKey = `${signedIn}:${initialIds.join(",")}`;
  const [seenKey, setSeenKey] = useState(serverKey);
  if (serverKey !== seenKey) {
    setSeenKey(serverKey);
    setIds(new Set(initialIds));
  }

  const showError = useCallback(
    (result: SetFavoriteResult | null) => {
      const error = result && !result.ok ? result.error : "failed";
      if (error === "signedOut") router.refresh(); // the session ended: show the guest view
      else if (error === "limitReached") toast.error(t("errors.limitReached", { max: MAX_FAVORITES }));
      else toast.error(t(`errors.${error}`));
    },
    [router, t],
  );

  const setFavorite = useCallback(
    async (productId: string, favorite: boolean) => {
      setIds((current) => withFavorite(current, productId, favorite));
      const result = await setFavoriteAction(productId, favorite).catch(() => null);
      if (result?.ok) return;
      setIds((current) => withFavorite(current, productId, !favorite));
      showError(result);
    },
    [showError],
  );

  // Back from signing in with a product the shopper clicked as a guest: save it now
  useEffect(() => {
    if (!signedIn) return;
    const productId = takePendingFavorite();
    if (!productId) return;
    void setFavoriteAction(productId, true)
      .catch(() => null)
      .then((result) => {
        if (!result?.ok) return showError(result);
        setIds((current) => withFavorite(current, productId, true));
        toast.success(t("toasts.added"), {
          action: { label: t("toasts.view"), onClick: () => router.push("/account/favorites") },
        });
      });
  }, [signedIn, showError, router, t]);

  const value = useMemo<FavoritesContextValue>(
    () => ({ signedIn, isFavorite: (productId) => ids.has(productId), setFavorite }),
    [signedIn, ids, setFavorite],
  );

  return <FavoritesContext.Provider value={value}>{children}</FavoritesContext.Provider>;
}

export function useFavorites(): FavoritesContextValue {
  const value = useContext(FavoritesContext);
  if (!value) throw new Error("useFavorites must be used inside <FavoritesProvider>");
  return value;
}
