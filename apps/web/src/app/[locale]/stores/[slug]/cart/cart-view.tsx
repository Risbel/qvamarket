"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowRightIcon,
  InfoIcon,
  MinusIcon,
  PlusIcon,
  ShoppingCartIcon,
  Trash2Icon,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { formatMoney } from "@/lib/money";
import { useHydrated } from "@/lib/use-hydrated";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { ButtonGroup, ButtonGroupText } from "@/components/ui/button-group";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  priceCartAction,
  type PriceCartActionResult,
} from "@/server/cart-actions";
import { useCart } from "../cart-provider";

type Priced = Extract<PriceCartActionResult, { ok: true }>;

/** The store's main button: brand colors (the text color is picked for contrast) */
const BRAND = "bg-(--brand) text-(--brand-foreground) hover:bg-(--brand)/85";

export function CartView() {
  const t = useTranslations("Store.cart");
  const locale = useLocale();
  const { storeSlug, currency, items, setQuantity, remove } = useCart();
  const [priced, setPriced] = useState<Priced | null>(null);
  const [error, setError] = useState<"failed" | "tooManyRequests" | null>(null);
  const hydrated = useHydrated();
  const latest = useRef(0);
  // variantId -> max available, set when the server lowered the quantity. Kept after the
  // corrected cart is re-priced as "ok", so the customer can see WHY the quantity changed.
  const [lowered, setLowered] = useState<Record<string, number>>({});

  // What the server must price: only ids and quantities (a stable string avoids refetch loops)
  const signature = JSON.stringify(items);

  useEffect(() => {
    if (items.length === 0) return;
    const request = ++latest.current;
    const timer = setTimeout(async () => {
      const result = await priceCartAction(storeSlug, currency, items).catch(
        () => null,
      );
      if (request !== latest.current) return; // a newer request is on its way: ignore this one
      if (!result || !result.ok) {
        setError(
          result && result.error === "tooManyRequests"
            ? "tooManyRequests"
            : "failed",
        );
        return;
      }
      setError(null);
      setPriced(result);
      // The server lowered a quantity (less stock than asked): keep the stored cart honest
      for (const line of result.lines) {
        if (line.status === "reduced") {
          setLowered((current) => ({
            ...current,
            [line.variantId]: line.maxQuantity,
          }));
          setQuantity(line.variantId, line.quantity);
        }
      }
    }, 150);
    return () => clearTimeout(timer);
    // `signature` stands for `items`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, storeSlug, currency]);

  // The cart lives in localStorage: the server (and the first render) cannot know it
  if (!hydrated) return <CartSkeleton rows={1} label={t("loading")} />;

  if (items.length === 0) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ShoppingCartIcon aria-hidden />
          </EmptyMedia>
          <EmptyTitle>{t("empty")}</EmptyTitle>
          <EmptyDescription>{t("emptyDescription")}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Link href="/" className={buttonVariants({ className: BRAND })}>
            {t("continueShopping")}
          </Link>
        </EmptyContent>
      </Empty>
    );
  }

  if (!priced) {
    if (error) {
      return (
        <p role="alert" className="text-sm text-destructive">
          {t(`errors.${error}`)}
        </p>
      );
    }
    return <CartSkeleton rows={items.length} label={t("loading")} />;
  }

  const money = (minor: number) => formatMoney(minor, priced.currency, locale);
  const change = (variantId: string, quantity: number) => {
    setLowered((current) => {
      const next = { ...current };
      delete next[variantId];
      return next;
    });
    setQuantity(variantId, quantity);
  };
  const stored = new Map(items.map((item) => [item.variantId, item.quantity]));
  // What is on screen follows the cart at once (a removed line disappears, a changed quantity
  // updates) with the unit prices the server sent; the server re-prices right after (volume
  // tiers can change the unit price) and it is the only source for the real amounts.
  const lines = priced.lines
    .filter((line) => stored.has(line.variantId))
    .map((line) => {
      const buyable = line.status === "ok" || line.status === "reduced";
      const quantity = buyable
        ? Math.min(stored.get(line.variantId) ?? 1, line.maxQuantity)
        : 0;
      return {
        ...line,
        buyable,
        quantity,
        lineTotalMinor: line.unitPriceMinor * quantity,
      };
    });
  const subtotalMinor = lines.reduce(
    (sum, line) => sum + line.lineTotalMinor,
    0,
  );
  const units = lines.reduce((sum, line) => sum + line.quantity, 0);

  return (
    <div className="grid items-start gap-6 md:grid-cols-[1fr_18rem]">
      <div className="flex flex-col gap-4">
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {t(`errors.${error}`)}
          </p>
        )}

        <Card className="py-0">
          <ul className="divide-y">
            {lines.map((line) => {
              const quantity = stored.get(line.variantId) ?? 1;
              return (
                <li
                  key={line.variantId}
                  className="flex gap-4 p-4"
                  data-status={line.status}
                >
                  <div
                    className={cn(
                      "size-20 shrink-0 overflow-hidden rounded-md border bg-muted",
                      !line.buyable && "opacity-50 grayscale",
                    )}
                  >
                    {line.imageUrl && (
                      // eslint-disable-next-line @next/next/no-img-element -- our own bucket, already compressed
                      <img
                        src={line.imageUrl}
                        alt=""
                        width={80}
                        height={80}
                        className="size-full object-cover"
                      />
                    )}
                  </div>

                  <div className="flex min-w-0 flex-1 flex-col gap-2">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 flex-col items-start gap-1">
                        {line.name && line.productSlug ? (
                          <Link
                            href={`/products/${line.productSlug}`}
                            className="font-medium leading-snug underline-offset-4 hover:underline"
                          >
                            {line.name}
                          </Link>
                        ) : (
                          <span className="font-medium text-muted-foreground">
                            {t("unavailable")}
                          </span>
                        )}
                        {line.variantTitle && (
                          <Badge variant="secondary">{line.variantTitle}</Badge>
                        )}
                        {line.buyable && (
                          <div className="text-sm text-muted-foreground tabular-nums">
                            {money(line.unitPriceMinor)}
                            {line.compareAtMinor !== null && (
                              <s className="ml-2 text-xs">
                                {money(line.compareAtMinor)}
                              </s>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="shrink-0 font-medium tabular-nums">
                        {line.buyable ? money(line.lineTotalMinor) : "—"}
                      </div>
                    </div>

                    {(line.status === "reduced" ||
                      lowered[line.variantId] !== undefined) && (
                      <Note>
                        {t("reduced", {
                          max: lowered[line.variantId] ?? line.maxQuantity,
                        })}
                      </Note>
                    )}
                    {line.status === "soldOut" && <Note>{t("soldOut")}</Note>}
                    {line.status === "unavailable" && (
                      <Note>
                        {line.name
                          ? t("notInCurrency", { currency: priced.currency })
                          : t("unavailableNote")}
                      </Note>
                    )}

                    <div className="mt-auto flex items-center justify-between gap-3">
                      {line.buyable ? (
                        <ButtonGroup aria-label={t("quantity")}>
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            aria-label={t("decrease")}
                            disabled={quantity <= 1}
                            onClick={() => change(line.variantId, quantity - 1)}
                          >
                            <MinusIcon aria-hidden />
                          </Button>
                          <ButtonGroupText className="min-w-9 justify-center bg-background tabular-nums dark:bg-input/30">
                            {quantity}
                          </ButtonGroupText>
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            aria-label={t("increase")}
                            disabled={quantity >= line.maxQuantity}
                            onClick={() => change(line.variantId, quantity + 1)}
                          >
                            <PlusIcon aria-hidden />
                          </Button>
                        </ButtonGroup>
                      ) : (
                        <span />
                      )}
                      <Button
                        type="button"
                        title={t("remove")}
                        variant="ghost"
                        size="icon"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => remove(line.variantId)}
                      >
                        <Trash2Icon aria-hidden />
                      </Button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      </div>

      <Card className="md:sticky md:top-[calc(var(--store-sticky,0px)+1rem)]">
        <CardHeader>
          <CardTitle className="text-base">{t("summary")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">
              {t("subtotalItems", { count: units })}
            </span>
            <span
              data-testid="subtotal"
              className="text-lg font-semibold tabular-nums"
            >
              {money(subtotalMinor)}
            </span>
          </div>
          <Separator />
          <p className="text-xs text-muted-foreground">{t("deliveryNote")}</p>
        </CardContent>
        <CardFooter className="flex-col items-stretch gap-2">
          {lines.some((line) => line.buyable) && (
            <Link
              href="/checkout"
              className={buttonVariants({
                size: "lg",
                className: cn(BRAND, "w-full"),
              })}
            >
              {t("checkout")}
              <ArrowRightIcon data-icon="inline-end" aria-hidden />
            </Link>
          )}
          <Link
            href="/"
            className={buttonVariants({
              variant: "ghost",
              size: "lg",
              className: "w-full",
            })}
          >
            {t("continueShopping")}
          </Link>
        </CardFooter>
      </Card>
    </div>
  );
}

/** Why a line changed or is left out of the total */
function Note({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-1.5 text-sm text-amber-700 dark:text-amber-400">
      <InfoIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
      {children}
    </p>
  );
}

function CartSkeleton({ rows, label }: { rows: number; label: string }) {
  return (
    <div
      role="status"
      className="grid items-start gap-6 md:grid-cols-[1fr_18rem]"
    >
      <span className="sr-only">{label}</span>
      <Card aria-hidden>
        <CardContent className="flex flex-col gap-4">
          {Array.from({ length: Math.max(rows, 1) }, (_, index) => (
            <div key={index} className="flex gap-4">
              <Skeleton className="size-20 shrink-0 rounded-md" />
              <div className="flex flex-1 flex-col gap-2">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="mt-2 h-8 w-28" />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
      <Skeleton className="h-48 rounded-xl" aria-hidden />
    </div>
  );
}
