"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { useCart } from "./cart-provider";

/** Header link to the cart with the number of units in it. */
export function CartLink() {
  const t = useTranslations("Store.cart");
  const { count } = useCart();

  return (
    <Link
      href="/cart"
      aria-label={t("linkLabel", { count })}
      className="flex items-center gap-2 rounded-md px-2 py-1 text-sm font-medium hover:opacity-80"
    >
      {t("link")}
      <span
        className="min-w-6 rounded-full px-2 py-0.5 text-center text-xs"
        style={{ backgroundColor: "var(--brand-foreground)", color: "var(--brand)" }}
        data-testid="cart-count"
      >
        {count}
      </span>
    </Link>
  );
}
