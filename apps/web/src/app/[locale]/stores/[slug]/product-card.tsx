import { EyeIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { PriceTag } from "@/components/price-tag";
import type { PublicListItem } from "@/server/public-catalog";
import { publicUrl } from "@/server/storage";
import { FavoriteButton } from "./favorite-button";
import { IMAGE_BUTTON } from "./image-button";
import { ProductCardCta } from "./product-card-actions";

/**
 * A product in a storefront grid (catalog, search results, favorites). The image fills the
 * top of the card; the image and the eye button open the product, the call to action adds it
 * to the cart.
 * `size="sm"` is the compact card for denser rows (related products): smaller buttons and badge.
 */
export async function ProductCard({
  product,
  currency,
  locale,
  eager,
  size = "default",
}: {
  product: PublicListItem;
  currency: string;
  locale: string;
  eager: boolean;
  size?: "default" | "sm";
}) {
  const t = await getTranslations("Store.catalog");
  const badge = product.soldOut ? t("soldOut") : product.price.promotion || product.price.compareAtMinor ? t("sale") : null;
  const sm = size === "sm";
  return (
    <li className="flex">
      <Card size="sm" className="w-full pt-0">
        <div className="group/image relative aspect-square overflow-hidden bg-muted">
          {/* A click on the image opens the product too. Out of the tab order and hidden from
              screen readers: the eye button is the same link with a proper label. */}
          <Link href={`/products/${product.slug}`} tabIndex={-1} aria-hidden className="block size-full">
            {product.imageKey ? (
              // eslint-disable-next-line @next/next/no-img-element -- our own bucket, already compressed
              <img
                src={publicUrl(product.imageKey)}
                alt={product.name}
                width={400}
                height={400}
                loading={eager ? "eager" : "lazy"}
                className={cn(
                  "size-full object-cover transition duration-500 group-hover/image:scale-105",
                  product.soldOut && "opacity-60",
                )}
              />
            ) : (
              <div className="flex size-full items-center justify-center text-xs text-muted-foreground">{t("noImage")}</div>
            )}
          </Link>
          {badge && (
            <span
              className={cn(
                "pointer-events-none absolute left-2 top-2 rounded-full font-medium",
                sm ? "px-2 py-0.5 text-[0.7rem]" : "px-2.5 py-0.5 text-xs",
              )}
              style={{ backgroundColor: "var(--brand-accent)", color: "var(--brand-accent-foreground)" }}
            >
              {badge}
            </span>
          )}
          <FavoriteButton productId={product.id} productName={product.name} className={cn("absolute right-2 top-2", sm && "size-8")} />
          <Link
            href={`/products/${product.slug}`}
            aria-label={t("view", { name: product.name })}
            title={t("view", { name: product.name })}
            className={cn(IMAGE_BUTTON, "absolute right-2 bottom-2", sm && "size-8")}
          >
            <EyeIcon className={sm ? "size-4" : "size-5"} aria-hidden />
          </Link>
        </div>
        <CardContent className="flex flex-1 flex-col gap-1">
          <p className="line-clamp-2 font-medium leading-snug">{product.name}</p>
          <PriceTag
            unitMinor={product.price.unitMinor}
            compareAtMinor={product.price.compareAtMinor}
            currency={currency}
            locale={locale}
            prefix={product.priceVaries ? t("from") : undefined}
            wasLabel={t("was")}
          />
        </CardContent>
        <CardContent>
          <ProductCardCta
            product={{ name: product.name, slug: product.slug, soldOut: product.soldOut, quickAdd: product.quickAdd }}
            soldOutLabel={t("soldOut")}
            size={size}
          />
        </CardContent>
      </Card>
    </li>
  );
}
