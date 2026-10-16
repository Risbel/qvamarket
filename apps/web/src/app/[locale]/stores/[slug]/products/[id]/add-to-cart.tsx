"use client";

import { useState } from "react";
import { MinusIcon, PlusIcon, ShoppingCartIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Link, useRouter } from "@/i18n/navigation";
import { MAX_LINE_QUANTITY } from "@/lib/cart";
import { useHydrated } from "@/lib/use-hydrated";
import { Button, buttonVariants } from "@/components/ui/button";
import { ButtonGroup, ButtonGroupText } from "@/components/ui/button-group";
import { useCart } from "../../cart-provider";

/** Quantity picker + "add to cart". `stock` null = not tracked. */
export function AddToCart({ variantId, stock }: { variantId: string; stock: number | null }) {
  const t = useTranslations("Store.cart");
  const router = useRouter();
  const hydrated = useHydrated();
  const { items, add } = useCart();
  const [quantity, setQuantity] = useState(1);

  const max = stock === null ? MAX_LINE_QUANTITY : Math.min(stock, MAX_LINE_QUANTITY);
  const inCart = items.find((item) => item.variantId === variantId)?.quantity ?? 0;
  const room = Math.max(max - inCart, 0);
  const chosen = Math.min(quantity, Math.max(room, 1));

  if (room === 0) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground">{t("atMax", { count: inCart })}</p>
        <Link href="/cart" className={buttonVariants({ variant: "outline", className: "w-fit" })}>
          {t("view")}
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <ButtonGroup aria-label={t("quantity")}>
        <Button
          type="button"
          variant="outline"
          size="icon-lg"
          aria-label={t("decrease")}
          disabled={chosen <= 1}
          onClick={() => setQuantity(chosen - 1)}
        >
          <MinusIcon aria-hidden />
        </Button>
        <ButtonGroupText className="min-w-10 justify-center bg-background tabular-nums dark:bg-input/30" aria-live="polite">
          {chosen}
        </ButtonGroupText>
        <Button
          type="button"
          variant="outline"
          size="icon-lg"
          aria-label={t("increase")}
          disabled={chosen >= room}
          onClick={() => setQuantity(chosen + 1)}
        >
          <PlusIcon aria-hidden />
        </Button>
      </ButtonGroup>

      <Button
        type="button"
        size="lg"
        disabled={!hydrated}
        onClick={() => {
          add(variantId, chosen, max);
          setQuantity(1);
          toast.success(t("added"), { action: { label: t("view"), onClick: () => router.push("/cart") } });
        }}
        className="px-5 bg-(--brand) text-(--brand-foreground) hover:bg-(--brand)/85"
      >
        <ShoppingCartIcon aria-hidden />
        {t("add")}
      </Button>
    </div>
  );
}
