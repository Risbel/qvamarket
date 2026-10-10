import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

/**
 * A price as the shopper sees it: the current price, the "was" price struck through when
 * there is one, and an optional label ("Desde" for products whose variants differ).
 * Presentation only: the amounts come from resolvePrice() on the server.
 */
export function PriceTag({
  unitMinor,
  compareAtMinor,
  currency,
  locale,
  prefix,
  size = "sm",
  wasLabel,
}: {
  unitMinor: number;
  compareAtMinor: number | null;
  currency: string;
  locale: string;
  prefix?: string;
  size?: "sm" | "lg";
  /** accessible label for the struck-through price, e.g. "Antes" */
  wasLabel: string;
}) {
  return (
    <span className={cn("inline-flex flex-wrap items-baseline gap-x-2", size === "lg" ? "text-2xl" : "text-sm")}>
      <span className={compareAtMinor !== null ? "font-semibold" : undefined}>
        {prefix && <span className="mr-1 text-muted-foreground">{prefix}</span>}
        {formatMoney(unitMinor, currency, locale)}
      </span>
      {compareAtMinor !== null && (
        <s className={cn("text-muted-foreground", size === "lg" ? "text-base" : "text-xs")} aria-label={`${wasLabel} ${formatMoney(compareAtMinor, currency, locale)}`}>
          {formatMoney(compareAtMinor, currency, locale)}
        </s>
      )}
    </span>
  );
}
