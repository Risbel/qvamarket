"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { PriceTag } from "@/components/price-tag";
import { formatMoney } from "@/lib/money";
import type { ResolvedPrice, VolumeTier } from "@/lib/pricing";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { AddToCart } from "./add-to-cart";

/** Only low stock is worth showing to a customer. */
const LOW_STOCK = 5;

type Option = { id: string; name: string; values: { id: string; value: string }[] };
type Variant = {
  id: string;
  optionValueIds: string[];
  stock: number | null;
  /** null = not sold in the selected currency */
  price: ResolvedPrice | null;
  tiers: VolumeTier[];
};

const buyable = (v: Variant) => v.price !== null && v.stock !== 0;

/**
 * Price, stock and "add to cart" of a product, with one row of buttons per option when it has
 * variants. Everything shown comes from the server (prices already resolved in the shopper's
 * currency); the cart only receives the chosen variant id.
 */
export function VariantPurchase({
  options,
  variants,
  currency,
  locale,
  initialVariantId,
}: {
  options: Option[];
  variants: Variant[];
  currency: string;
  locale: string;
  initialVariantId?: string;
}) {
  const t = useTranslations("Store.product");
  const [selectedId, setSelectedId] = useState(
    () =>
      variants.find((v) => v.id === initialVariantId)?.id ??
      (variants.find(buyable) ?? variants.find((v) => v.price !== null) ?? variants[0])?.id,
  );
  const variant = variants.find((v) => v.id === selectedId) ?? variants[0];
  if (!variant) return null;

  function choose(optionIndex: number, valueId: string) {
    const wanted = variant.optionValueIds.map((id, i) => (i === optionIndex ? valueId : id));
    const containing = variants.filter((v) => v.optionValueIds[optionIndex] === valueId);
    // The exact combination if it exists, otherwise the best variant with that value
    const next =
      containing.find((v) => v.optionValueIds.every((id, i) => id === wanted[i])) ??
      containing.find(buyable) ??
      containing.find((v) => v.price !== null) ??
      containing[0];
    if (!next) return;
    setSelectedId(next.id);
    // Shareable link to the chosen variant, without a navigation
    const url = new URL(window.location.href);
    url.searchParams.set("variant", next.id);
    window.history.replaceState(null, "", url);
  }

  const price = variant.price;
  const soldOut = variant.stock === 0;
  const lowStock = variant.stock !== null && variant.stock > 0 && variant.stock <= LOW_STOCK;

  return (
    <div className="flex flex-col gap-4">
      {options.map((option, optionIndex) => (
        <fieldset key={option.id} className="flex flex-col gap-2">
          <legend className="mb-2 text-sm">
            <span className="font-medium">{option.name}:</span>{" "}
            <span className="text-muted-foreground">
              {option.values.find((v) => v.id === variant.optionValueIds[optionIndex])?.value}
            </span>
          </legend>
          <div className="flex flex-wrap gap-2">
            {option.values.map((value) => {
              const selected = variant.optionValueIds[optionIndex] === value.id;
              const withValue = variants.filter((v) => v.optionValueIds[optionIndex] === value.id);
              // Same choice in the other options, this value here
              const sameRest = withValue.find((v) =>
                v.optionValueIds.every((id, i) => i === optionIndex || id === variant.optionValueIds[i]),
              );
              const sellable = withValue.some((v) => v.price !== null);
              const unavailable = sameRest ? !buyable(sameRest) : !withValue.some(buyable);
              return (
                <Button
                  key={value.id}
                  type="button"
                  variant="outline"
                  size="lg"
                  aria-pressed={selected}
                  disabled={!sellable}
                  onClick={() => choose(optionIndex, value.id)}
                  className={cn(
                    "min-w-11 px-3 disabled:opacity-40",
                    selected && "border-(--brand) ring-1 ring-(--brand) dark:border-(--brand)",
                    unavailable && "text-muted-foreground line-through",
                  )}
                >
                  {value.value}
                </Button>
              );
            })}
          </div>
        </fieldset>
      ))}

      {price ? (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <PriceTag
              unitMinor={price.unitMinor}
              compareAtMinor={price.compareAtMinor}
              currency={currency}
              locale={locale}
              size="lg"
              wasLabel={t("was")}
            />
            {(soldOut || price.compareAtMinor !== null) && (
              <span
                className="rounded-full px-3 py-1 text-sm font-medium"
                style={{ backgroundColor: "var(--brand-accent)", color: "var(--brand-accent-foreground)" }}
              >
                {soldOut ? t("soldOut") : t("sale")}
              </span>
            )}
          </div>

          {variant.tiers.length > 0 && (
            <div className="rounded-lg border p-3 text-sm" data-testid="volume-tiers">
              <p className="mb-1 font-medium">{t("tiersTitle")}</p>
              <ul className="flex flex-col gap-0.5 text-muted-foreground">
                {variant.tiers.map((tier) => (
                  <li key={tier.minQuantity}>
                    {t("tierLine", { count: tier.minQuantity, price: formatMoney(tier.unitMinor, currency, locale) })}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {lowStock && <p className="text-sm text-muted-foreground">{t("lowStock", { count: variant.stock! })}</p>}
          {/* keyed: the quantity starts again at 1 for another variant */}
          {!soldOut && <AddToCart key={variant.id} variantId={variant.id} stock={variant.stock} />}
        </>
      ) : (
        <p className="rounded-md bg-muted p-3 text-sm">
          {options.length > 0 ? t("variantNotInCurrency", { currency }) : t("notInCurrency", { currency })}
        </p>
      )}
    </div>
  );
}
