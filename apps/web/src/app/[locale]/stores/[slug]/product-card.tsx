import { EyeIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { EMPTY_PIXEL } from "@/lib/images";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { PriceTag } from "@/components/price-tag";
import type { PublicListItem } from "@/server/public-catalog";
import { publicUrl } from "@/server/storage";
import { FavoriteButton } from "./favorite-button";
import { ProductCardCta } from "./product-card-actions";

/** the round buttons over the image (the heart uses the same look) */
const IMAGE_BUTTON =
  "flex size-9 items-center justify-center rounded-full bg-background/85 text-foreground shadow-sm backdrop-blur transition-transform hover:scale-110 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";

/**
 * A product in a storefront grid (catalog, search results, favorites). The image fills the
 * top of the card; the image and the eye button open the product, the call to action adds it
 * to the cart.
 * With a pointer, hovering the image shows the product's second image.
 */
export async function ProductCard({
  product,
  currency,
  locale,
  eager,
}: {
  product: PublicListItem;
  currency: string;
  locale: string;
  eager: boolean;
}) {
  const t = await getTranslations("Store.catalog");
  const badge = product.soldOut ? t("soldOut") : product.price.promotion || product.price.compareAtMinor ? t("sale") : null;
  const second = product.imageKey ? product.secondImageKey : null;
  return (
    <li className="flex">
      <Card size="sm" className="w-full pt-0">
        <div className="group/image relative aspect-square overflow-hidden bg-muted">
          {/* A click on the image opens the product too. Out of the tab order and hidden from
              screen readers: the eye button is the same link with a proper label. */}
          <Link href={`/products/${product.slug}`} tabIndex={-1} aria-hidden className="block size-full">
            {product.imageKey ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element -- our own bucket, already compressed */}
                <img
                  src={publicUrl(product.imageKey)}
                  alt={product.name}
                  width={400}
                  height={400}
                  loading={eager ? "eager" : "lazy"}
                  className={cn(
                    "size-full object-cover transition duration-500",
                    second ? "group-hover/image:opacity-0" : "group-hover/image:scale-105",
                    product.soldOut && "opacity-60",
                  )}
                />
                {second && (
                  // Only screens with a pointer can hover: the others get the empty pixel, so a
                  // phone never downloads the second image
                  <picture>
                    <source media="(hover: none)" srcSet={EMPTY_PIXEL} />
                    <img
                      src={publicUrl(second)}
                      alt=""
                      width={400}
                      height={400}
                      loading="lazy"
                      className={cn(
                        "absolute inset-0 size-full object-cover opacity-0 transition-opacity duration-500 group-hover/image:opacity-100",
                        product.soldOut && "group-hover/image:opacity-60",
                      )}
                    />
                  </picture>
                )}
              </>
            ) : (
              <div className="flex size-full items-center justify-center text-xs text-muted-foreground">{t("noImage")}</div>
            )}
          </Link>
          {badge && (
            <span
              className="pointer-events-none absolute left-2 top-2 rounded-full px-2.5 py-0.5 text-xs font-medium"
              style={{ backgroundColor: "var(--brand-accent)", color: "var(--brand-accent-foreground)" }}
            >
              {badge}
            </span>
          )}
          <FavoriteButton productId={product.id} productName={product.name} className="absolute right-2 top-2" />
          <Link
            href={`/products/${product.slug}`}
            aria-label={t("view", { name: product.name })}
            title={t("view", { name: product.name })}
            className={cn(IMAGE_BUTTON, "absolute right-2 bottom-2")}
          >
            <EyeIcon className="size-5" aria-hidden />
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
          />
        </CardContent>
      </Card>
    </li>
  );
}
