"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { MAX_LINE_QUANTITY } from "@/lib/cart";
import { useHydrated } from "@/lib/use-hydrated";
import { useCart } from "../../cart-provider";

/** Quantity picker + "add to cart". `stock` null = not tracked. */
export function AddToCart({ productId, stock }: { productId: string; stock: number | null }) {
  const t = useTranslations("Store.cart");
  const hydrated = useHydrated();
  const { items, add } = useCart();
  const [quantity, setQuantity] = useState(1);
  const [added, setAdded] = useState(false);

  const max = stock === null ? MAX_LINE_QUANTITY : Math.min(stock, MAX_LINE_QUANTITY);
  const inCart = items.find((item) => item.productId === productId)?.quantity ?? 0;
  const room = Math.max(max - inCart, 0);
  const chosen = Math.min(quantity, Math.max(room, 1));

  if (room === 0) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground">{t("atMax", { count: inCart })}</p>
        <Link href="/cart" className="w-fit text-sm font-medium underline underline-offset-4">
          {t("view")}
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <div className="flex items-center rounded-md border" role="group" aria-label={t("quantity")}>
          <button
            type="button"
            className="size-9 text-lg disabled:opacity-40"
            aria-label={t("decrease")}
            disabled={chosen <= 1}
            onClick={() => setQuantity(chosen - 1)}
          >
            −
          </button>
          <span className="min-w-8 text-center tabular-nums" aria-live="polite">
            {chosen}
          </span>
          <button
            type="button"
            className="size-9 text-lg disabled:opacity-40"
            aria-label={t("increase")}
            disabled={chosen >= room}
            onClick={() => setQuantity(chosen + 1)}
          >
            +
          </button>
        </div>

        <button
          type="button"
          disabled={!hydrated}
          onClick={() => {
            add(productId, chosen, max);
            setAdded(true);
            setQuantity(1);
          }}
          className="h-9 rounded-md px-5 text-sm font-medium disabled:opacity-50"
          style={{ backgroundColor: "var(--brand)", color: "var(--brand-foreground)" }}
        >
          {t("add")}
        </button>
      </div>

      {added && (
        <p role="status" className="text-sm text-muted-foreground">
          {t("added")}{" "}
          <Link href="/cart" className="font-medium text-foreground underline underline-offset-4">
            {t("view")}
          </Link>
        </p>
      )}
    </div>
  );
}
