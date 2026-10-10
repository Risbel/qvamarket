"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { formatMoney } from "@/lib/money";
import { priceCartAction, type PriceCartActionResult } from "@/server/cart-actions";
import { useCart } from "../cart-provider";

type Priced = Extract<PriceCartActionResult, { ok: true }>;

export function CartView() {
  const t = useTranslations("Store.cart");
  const locale = useLocale();
  const { storeSlug, items, setQuantity, remove } = useCart();
  const [priced, setPriced] = useState<Priced | null>(null);
  const [error, setError] = useState<"failed" | "tooManyRequests" | null>(null);
  const latest = useRef(0);
  // productId -> max available, set when the server lowered the quantity. Kept after the
  // corrected cart is re-priced as "ok", so the customer can see WHY the quantity changed.
  const [lowered, setLowered] = useState<Record<string, number>>({});

  // What the server must price: only ids and quantities (a stable string avoids refetch loops)
  const signature = JSON.stringify(items);

  useEffect(() => {
    if (items.length === 0) return;
    const request = ++latest.current;
    const timer = setTimeout(async () => {
      const result = await priceCartAction(storeSlug, items).catch(() => null);
      if (request !== latest.current) return; // a newer request is on its way: ignore this one
      if (!result || !result.ok) {
        setError(result && result.error === "tooManyRequests" ? "tooManyRequests" : "failed");
        return;
      }
      setError(null);
      setPriced(result);
      // The server lowered a quantity (less stock than asked): keep the stored cart honest
      for (const line of result.lines) {
        if (line.status === "reduced") {
          setLowered((current) => ({ ...current, [line.productId]: line.maxQuantity }));
          setQuantity(line.productId, line.quantity);
        }
      }
    }, 150);
    return () => clearTimeout(timer);
    // `signature` stands for `items`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, storeSlug]);

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-muted-foreground">{t("empty")}</p>
        <Link href="/" className="text-sm font-medium underline underline-offset-4">
          {t("continueShopping")}
        </Link>
      </div>
    );
  }

  if (!priced) {
    return (
      <p role="status" className="text-muted-foreground">
        {error ? t(`errors.${error}`) : t("loading")}
      </p>
    );
  }

  const money = (minor: number) => formatMoney(minor, priced.currency, locale);
  const change = (productId: string, quantity: number) => {
    setLowered(({ [productId]: _gone, ...rest }) => rest);
    setQuantity(productId, quantity);
  };
  const stored = new Map(items.map((item) => [item.productId, item.quantity]));
  // What is on screen follows the cart at once (a removed line disappears, a changed quantity
  // updates), using the prices the server sent. The server re-prices right after, and it is
  // the only source for the real amounts.
  const lines = priced.lines
    .filter((line) => stored.has(line.productId))
    .map((line) => {
      const buyable = line.status === "ok" || line.status === "reduced";
      const quantity = buyable ? Math.min(stored.get(line.productId) ?? 1, line.maxQuantity) : 0;
      return { ...line, quantity, lineTotalMinor: line.unitPriceMinor * quantity };
    });
  const subtotalMinor = lines.reduce((sum, line) => sum + line.lineTotalMinor, 0);

  return (
    <div className="flex flex-col gap-6">
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {t(`errors.${error}`)}
        </p>
      )}

      <ul className="flex flex-col divide-y rounded-lg border">
        {lines.map((line) => {
          const buyable = line.status === "ok" || line.status === "reduced";
          return (
            <li key={line.productId} className="flex gap-4 p-4" data-status={line.status}>
              <div className="size-20 shrink-0 overflow-hidden rounded-md border bg-muted">
                {line.imageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element -- our own bucket, already compressed
                  <img src={line.imageUrl} alt="" width={80} height={80} className="size-full object-cover" />
                )}
              </div>

              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    {line.name ? (
                      <Link
                        href={`/products/${line.productId}`}
                        className="font-medium leading-snug hover:underline"
                      >
                        {line.name}
                      </Link>
                    ) : (
                      <span className="font-medium text-muted-foreground">{t("unavailable")}</span>
                    )}
                    {buyable && (
                      <div className="text-sm text-muted-foreground">{money(line.unitPriceMinor)}</div>
                    )}
                  </div>
                  <div className="shrink-0 font-medium tabular-nums">
                    {buyable ? money(line.lineTotalMinor) : "—"}
                  </div>
                </div>

                {(line.status === "reduced" || lowered[line.productId] !== undefined) && (
                  <p className="text-sm text-muted-foreground">
                    {t("reduced", { max: lowered[line.productId] ?? line.maxQuantity })}
                  </p>
                )}
                {line.status === "soldOut" && (
                  <p className="text-sm text-muted-foreground">{t("soldOut")}</p>
                )}
                {line.status === "unavailable" && (
                  <p className="text-sm text-muted-foreground">{t("unavailableNote")}</p>
                )}

                <div className="flex items-center gap-4">
                  {buyable && (
                    <div className="flex items-center rounded-md border" role="group" aria-label={t("quantity")}>
                      <button
                        type="button"
                        className="size-8 text-lg disabled:opacity-40"
                        aria-label={t("decrease")}
                        disabled={(stored.get(line.productId) ?? 1) <= 1}
                        onClick={() => change(line.productId, (stored.get(line.productId) ?? 1) - 1)}
                      >
                        −
                      </button>
                      <span className="min-w-8 text-center tabular-nums">{stored.get(line.productId)}</span>
                      <button
                        type="button"
                        className="size-8 text-lg disabled:opacity-40"
                        aria-label={t("increase")}
                        disabled={(stored.get(line.productId) ?? 1) >= line.maxQuantity}
                        onClick={() => change(line.productId, (stored.get(line.productId) ?? 1) + 1)}
                      >
                        +
                      </button>
                    </div>
                  )}
                  <button
                    type="button"
                    className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
                    onClick={() => remove(line.productId)}
                  >
                    {t("remove")}
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="flex items-center justify-between rounded-lg border p-4 text-lg font-semibold">
        <span>{t("subtotal")}</span>
        <span data-testid="subtotal" className="tabular-nums">
          {money(subtotalMinor)}
        </span>
      </div>

      <Link href="/" className="w-fit text-sm font-medium underline underline-offset-4">
        {t("continueShopping")}
      </Link>
    </div>
  );
}
