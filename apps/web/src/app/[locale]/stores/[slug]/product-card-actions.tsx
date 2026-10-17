"use client";

import { CheckIcon, ShoppingCartIcon, SlidersHorizontalIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Link, useRouter } from "@/i18n/navigation";
import { MAX_LINE_QUANTITY } from "@/lib/cart";
import { useHydrated } from "@/lib/use-hydrated";
import { cn } from "@/lib/utils";
import { Button, buttonVariants } from "@/components/ui/button";
import type { PublicListItem } from "@/server/public-catalog";
import { useCart } from "./cart-provider";

const BRAND = { backgroundColor: "var(--brand)", color: "var(--brand-foreground)" };
const CTA = "w-full";
const CTA_SIZE = { default: "h-9", sm: "h-8 text-[0.8rem]" } as const;

/**
 * The call to action of a product card: adds one unit straight to the cart when the product
 * has a single variant in this currency, otherwise links to the product page to pick one.
 */
export function ProductCardCta({
  product,
  soldOutLabel,
  size = "default",
}: {
  product: Pick<PublicListItem, "name" | "slug" | "soldOut" | "quickAdd">;
  soldOutLabel: string;
  size?: "default" | "sm";
}) {
  const cta = cn(CTA, CTA_SIZE[size]);
  const t = useTranslations("Store.catalog");
  const tCart = useTranslations("Store.cart");
  const router = useRouter();
  const hydrated = useHydrated();
  const { items, add } = useCart();

  if (product.soldOut) {
    return (
      <Button variant="outline" className={cta} disabled>
        {soldOutLabel}
      </Button>
    );
  }

  const quickAdd = product.quickAdd;
  if (!quickAdd) {
    return (
      <Link
        href={`/products/${product.slug}`}
        aria-label={t("chooseOptionsLabel", { name: product.name })}
        className={cn(buttonVariants({ variant: "outline" }), cta)}
      >
        <SlidersHorizontalIcon aria-hidden />
        {t("chooseOptions")}
      </Link>
    );
  }

  // Same limits as the product page: never more than the stock (null = not tracked)
  const max = quickAdd.stock === null ? MAX_LINE_QUANTITY : Math.min(quickAdd.stock, MAX_LINE_QUANTITY);
  const inCart = items.find((item) => item.variantId === quickAdd.variantId)?.quantity ?? 0;
  if (inCart >= max) {
    return (
      <Button variant="outline" className={cta} disabled aria-label={t("inCartLabel", { name: product.name })}>
        <CheckIcon aria-hidden />
        {t("inCart")}
      </Button>
    );
  }

  return (
    <Button
      className={cn(cta, "hover:opacity-90")}
      style={BRAND}
      disabled={!hydrated}
      aria-label={t("addLabel", { name: product.name })}
      onClick={() => {
        add(quickAdd.variantId, 1, max);
        toast.success(tCart("added"), { action: { label: tCart("view"), onClick: () => router.push("/cart") } });
      }}
    >
      <ShoppingCartIcon aria-hidden />
      {t("add")}
    </Button>
  );
}
