"use client";

import { ShoppingCartIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { useCart } from "./cart-provider";

/** Header cart icon; the number of units sits on its top-right corner (hidden when empty). */
export function CartLink() {
  const t = useTranslations("Store.cart");
  const { count } = useCart();

  return (
    <Link
      href="/cart"
      aria-label={t("linkLabel", { count })}
      className="relative flex size-9 items-center justify-center rounded-full hover:bg-current/15 focus-visible:ring-2 focus-visible:ring-current focus-visible:outline-none"
    >
      <ShoppingCartIcon className="size-5" aria-hidden />
      {count > 0 && (
        <span
          className="absolute -top-0.5 -right-0.5 flex h-4.5 min-w-4.5 items-center justify-center rounded-full px-1 text-[0.625rem] leading-none font-semibold tabular-nums"
          style={{ backgroundColor: "var(--brand-foreground)", color: "var(--brand)" }}
          data-testid="cart-count"
          aria-hidden
        >
          {count > 99 ? "99+" : count}
        </span>
      )}
    </Link>
  );
}
