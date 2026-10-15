import { Link } from "@/i18n/navigation";
import { PriceTag } from "@/components/price-tag";
import type { PublicListItem } from "@/server/public-catalog";
import { publicUrl } from "@/server/storage";

export type ProductCardLabels = { soldOut: string; noImage: string; from: string; sale: string; was: string };

/** A product in a storefront grid (catalog, search results). */
export function ProductCard({
  product,
  currency,
  locale,
  eager,
  labels,
}: {
  product: PublicListItem;
  currency: string;
  locale: string;
  eager: boolean;
  labels: ProductCardLabels;
}) {
  const badge = product.soldOut ? labels.soldOut : product.price.promotion || product.price.compareAtMinor ? labels.sale : null;
  return (
    <li>
      <Link
        href={`/products/${product.slug}`}
        className="group flex flex-col gap-2 rounded-lg outline-offset-4 focus-visible:outline-2"
      >
        <div className="relative aspect-square overflow-hidden rounded-lg border bg-muted">
          {product.imageKey ? (
            // eslint-disable-next-line @next/next/no-img-element -- our own bucket, already compressed
            <img
              src={publicUrl(product.imageKey)}
              alt={product.name}
              width={400}
              height={400}
              loading={eager ? "eager" : "lazy"}
              className={`size-full object-cover transition-transform group-hover:scale-105 ${product.soldOut ? "opacity-60" : ""}`}
            />
          ) : (
            <div className="flex size-full items-center justify-center text-xs text-muted-foreground">{labels.noImage}</div>
          )}
          {badge && (
            <span
              className="absolute left-2 top-2 rounded-full px-2.5 py-0.5 text-xs font-medium"
              style={{ backgroundColor: "var(--brand-accent)", color: "var(--brand-accent-foreground)" }}
            >
              {badge}
            </span>
          )}
        </div>
        <div className="flex flex-col">
          <span className="font-medium leading-snug">{product.name}</span>
          <PriceTag
            unitMinor={product.price.unitMinor}
            compareAtMinor={product.price.compareAtMinor}
            currency={currency}
            locale={locale}
            prefix={product.priceVaries ? labels.from : undefined}
            wasLabel={labels.was}
          />
        </div>
      </Link>
    </li>
  );
}
