"use client";

import { useMemo, useState } from "react";
import { MinusIcon, PackageIcon, PlusIcon, ReceiptTextIcon, SearchIcon, Trash2Icon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import type { CountryOption } from "@/components/country-select";
import { useStoreId } from "@/components/panel-scope";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { formatMoney } from "@/lib/money";
import {
  addToTicket,
  POS_MAX_QUANTITY,
  priceTicket,
  type PosCategory,
  type PosPrices,
  type PosProduct,
  type PosVariant,
  type TicketItem,
  type TicketLine,
} from "@/lib/pos";
import { resolvePrice } from "@/lib/pricing";
import { normalizeSearchText, searchTerms } from "@/lib/search";
import { useHydrated } from "@/lib/use-hydrated";
import { ChargeForm, SaleDone, type CompletedSale } from "./charge-form";

type Currency = { code: string; digits: number };
export type PosScreenProduct = PosProduct & { imageUrl: string | null };

type Props = {
  categories: PosCategory[];
  products: PosScreenProduct[];
  prices: PosPrices;
  currencies: Currency[];
  defaultCurrency: string;
  phoneCountries: CountryOption[];
  phoneCountry: string;
};

/** "all", a category id, or products without a category. */
type Filter = "all" | "none" | string;

const storageKey = (storeId: string) => `qvashop:pos:v1:${storeId}`;

/**
 * The ticket and the chosen currency live in this browser (per store) so a reload keeps the
 * sale in progress. The screen mounts after hydration, so it can read them on its first render.
 */
export function PosRoot(props: Props) {
  const hydrated = useHydrated();
  if (!hydrated) {
    return (
      <div className="grid flex-1 gap-4 p-4 lg:grid-cols-[1fr_24rem]">
        <Skeleton className="h-full min-h-64" />
        <Skeleton className="hidden h-full min-h-64 lg:block" />
      </div>
    );
  }
  return <PosScreen {...props} />;
}

function readSaved(storeId: string, currencies: Currency[], fallback: string): { currency: string; items: TicketItem[] } {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey(storeId)) ?? "null") as { currency?: unknown; items?: unknown } | null;
    const currency = currencies.some((c) => c.code === saved?.currency) ? (saved!.currency as string) : fallback;
    const items = Array.isArray(saved?.items)
      ? saved.items.filter(
          (i): i is TicketItem =>
            Boolean(i) && typeof i.variantId === "string" && Number.isInteger(i.quantity) && i.quantity >= 1 && i.quantity <= POS_MAX_QUANTITY,
        )
      : [];
    return { currency, items };
  } catch {
    return { currency: fallback, items: [] };
  }
}

function PosScreen({ categories, products, prices, currencies, defaultCurrency, phoneCountries, phoneCountry }: Props) {
  const t = useTranslations("Pos");
  const locale = useLocale();
  const storeId = useStoreId();
  const [initial] = useState(() => readSaved(storeId, currencies, defaultCurrency));
  const [currency, setCurrency] = useState(initial.currency);
  const [items, setItems] = useState<TicketItem[]>(initial.items);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [picking, setPicking] = useState<PosScreenProduct | null>(null);
  const [charging, setCharging] = useState(false);
  const [ticketOpen, setTicketOpen] = useState(false);
  const [done, setDone] = useState<CompletedSale | null>(null);
  // one key per charge attempt of this ticket: a retried submit cannot create a second sale
  const [saleKey, setSaleKey] = useState(() => crypto.randomUUID());

  const digits = currencies.find((c) => c.code === currency)?.digits ?? 2;
  const money = (minor: number) => formatMoney(minor, currency, locale);
  const rows = prices[currency] ?? {};
  const ticket = priceTicket(items, products, rows);
  const units = items.reduce((sum, i) => sum + i.quantity, 0);

  function save(next: { currency?: string; items?: TicketItem[] }) {
    const value = { currency: next.currency ?? currency, items: next.items ?? items };
    if (next.currency !== undefined) setCurrency(next.currency);
    if (next.items !== undefined) {
      setItems(next.items);
      setSaleKey(crypto.randomUUID());
    }
    try {
      localStorage.setItem(storageKey(storeId), JSON.stringify(value));
    } catch {
      // private mode / storage full: the ticket still works, it just is not kept on reload
    }
  }

  function add(variant: PosVariant) {
    const current = items.find((i) => i.variantId === variant.id)?.quantity ?? 0;
    if (variant.stock !== null && current >= variant.stock) {
      toast.error(t("onlyLeft", { count: variant.stock }));
      return;
    }
    save({ items: addToTicket(items, variant.id, variant.stock) });
    setPicking(null);
  }

  /** Variants that can go in the ticket in this currency (priced and not sold out). */
  const buyable = (product: PosProduct) => product.variants.filter((v) => rows[v.id] && resolvePrice(rows[v.id], 1) && v.stock !== 0);

  function tap(product: PosScreenProduct) {
    const options = buyable(product);
    if (options.length === 1 && product.variants.length === 1) add(options[0]);
    else setPicking(product);
  }

  const terms = useMemo(() => searchTerms(query), [query]);
  const visible = products.filter((p) => {
    if (filter === "none" ? p.categoryId !== null : filter !== "all" && p.categoryId !== filter) return false;
    if (terms.length === 0) return true;
    const text = normalizeSearchText([p.name, ...p.variants.flatMap((v) => [v.title ?? "", v.sku ?? ""])].join(" "));
    return terms.every((term) => text.includes(term));
  });

  /** Enter in the search: an exact SKU (a barcode scanner types it + Enter) goes straight in. */
  function onSearchEnter() {
    const code = query.trim().toLowerCase();
    if (!code) return;
    for (const product of products) {
      const variant = product.variants.find((v) => v.sku?.toLowerCase() === code);
      if (variant) {
        if (!rows[variant.id] || !resolvePrice(rows[variant.id], 1)) toast.error(t("notInCurrency", { currency }));
        else if (variant.stock === 0) toast.error(t("soldOut"));
        else add(variant);
        setQuery("");
        return;
      }
    }
    if (visible.length === 1) tap(visible[0]);
  }

  const usedCategories = categories.filter((c) => products.some((p) => p.categoryId === c.id));
  const hasUncategorized = products.some((p) => p.categoryId === null);

  const ticketPanel = (
    <TicketPanel
      lines={ticket.lines}
      totalMinor={ticket.totalMinor}
      sellable={ticket.sellable}
      money={money}
      onQuantity={(variantId, quantity) =>
        save({
          items:
            quantity <= 0
              ? items.filter((i) => i.variantId !== variantId)
              : items.map((i) => (i.variantId === variantId ? { ...i, quantity: Math.min(quantity, POS_MAX_QUANTITY) } : i)),
        })
      }
      onClear={() => save({ items: [] })}
      onCharge={() => {
        setTicketOpen(false);
        setCharging(true);
      }}
    />
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
      <section aria-label={t("catalog")} className="flex min-w-0 flex-1 flex-col gap-3 p-4 pb-24 lg:pb-4">
        <div className="flex flex-wrap items-center gap-2">
          <InputGroup className="min-w-48 flex-1">
            <InputGroupAddon>
              <SearchIcon />
            </InputGroupAddon>
            <InputGroupInput
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  onSearchEnter();
                }
              }}
              placeholder={t("searchPlaceholder")}
              aria-label={t("search")}
              autoComplete="off"
              autoFocus
            />
          </InputGroup>
          {currencies.length > 1 && (
            <ButtonGroup aria-label={t("currency")}>
              {currencies.map((c) => (
                <Button
                  key={c.code}
                  variant={c.code === currency ? "default" : "outline"}
                  aria-pressed={c.code === currency}
                  onClick={() => save({ currency: c.code })}
                >
                  {c.code}
                </Button>
              ))}
            </ButtonGroup>
          )}
        </div>

        {(usedCategories.length > 0 || hasUncategorized) && (
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1" role="group" aria-label={t("categories")}>
            <Button size="sm" variant={filter === "all" ? "default" : "outline"} aria-pressed={filter === "all"} onClick={() => setFilter("all")}>
              {t("all")}
            </Button>
            {usedCategories.map((c) => (
              <Button key={c.id} size="sm" variant={filter === c.id ? "default" : "outline"} aria-pressed={filter === c.id} onClick={() => setFilter(c.id)}>
                {c.name}
              </Button>
            ))}
            {hasUncategorized && usedCategories.length > 0 && (
              <Button size="sm" variant={filter === "none" ? "default" : "outline"} aria-pressed={filter === "none"} onClick={() => setFilter("none")}>
                {t("uncategorized")}
              </Button>
            )}
          </div>
        )}

        {visible.length === 0 ? (
          <p className="py-12 text-center text-muted-foreground">{products.length === 0 ? t("noProducts") : t("noMatches")}</p>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            {visible.map((product) => (
              <li key={product.id}>
                <ProductTile
                  product={product}
                  rows={rows}
                  inTicket={product.variants.reduce((sum, v) => sum + (items.find((i) => i.variantId === v.id)?.quantity ?? 0), 0)}
                  canAdd={buyable(product).length > 0}
                  money={money}
                  currency={currency}
                  onTap={() => tap(product)}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <aside aria-label={t("ticket")} className="hidden w-96 shrink-0 flex-col border-l lg:flex">
        {ticketPanel}
      </aside>

      {/* Phones and tablets: the ticket opens from a bar at the bottom */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-background p-3 lg:hidden">
        <Button size="lg" className="h-12 w-full justify-between text-base" onClick={() => setTicketOpen(true)}>
          <span className="flex items-center gap-2">
            <ReceiptTextIcon />
            {t("ticketCount", { count: units })}
          </span>
          <span className="tabular-nums">{money(ticket.totalMinor)}</span>
        </Button>
      </div>
      <Sheet open={ticketOpen} onOpenChange={setTicketOpen}>
        <SheetContent side="bottom" className="flex max-h-[90dvh] flex-col gap-0 p-0">
          <SheetHeader className="border-b">
            <SheetTitle>{t("ticket")}</SheetTitle>
          </SheetHeader>
          {ticketPanel}
        </SheetContent>
      </Sheet>

      <Dialog open={picking !== null} onOpenChange={(open) => !open && setPicking(null)}>
        <DialogContent>
          {picking && (
            <VariantPicker
              product={picking}
              rows={rows}
              currency={currency}
              money={money}
              inTicket={(id) => items.find((i) => i.variantId === id)?.quantity ?? 0}
              onPick={add}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={charging} onOpenChange={(open) => !open && setCharging(false)}>
        <DialogContent className="max-h-[95dvh] overflow-y-auto sm:max-w-lg">
          {charging && (
            <ChargeForm
              currency={currency}
              digits={digits}
              totalMinor={ticket.totalMinor}
              items={items}
              saleKey={saleKey}
              phoneCountries={phoneCountries}
              phoneCountry={phoneCountry}
              onCancel={() => setCharging(false)}
              onDone={(sale) => {
                setCharging(false);
                save({ items: [] });
                setDone(sale);
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={done !== null} onOpenChange={(open) => !open && setDone(null)}>
        <DialogContent>{done && <SaleDone sale={done} currency={currency} onNext={() => setDone(null)} />}</DialogContent>
      </Dialog>
    </div>
  );
}

function ProductTile({
  product,
  rows,
  inTicket,
  canAdd,
  money,
  currency,
  onTap,
}: {
  product: PosScreenProduct;
  rows: PosPrices[string];
  inTicket: number;
  canAdd: boolean;
  money: (minor: number) => string;
  currency: string;
  onTap: () => void;
}) {
  const t = useTranslations("Pos");
  const priced = product.variants.map((v) => ({ v, price: rows[v.id] ? resolvePrice(rows[v.id], 1) : null })).filter((x) => x.price);
  const cheapest = priced.reduce<number | null>((min, x) => (min === null || x.price!.unitMinor < min ? x.price!.unitMinor : min), null);
  const varies = new Set(priced.map((x) => x.price!.unitMinor)).size > 1;
  const tracked = product.variants.every((v) => v.stock !== null);
  const stock = tracked ? product.variants.reduce((sum, v) => sum + (v.stock ?? 0), 0) : null;
  const soldOut = priced.length > 0 && priced.every((x) => x.v.stock === 0);

  return (
    <Button
      variant="outline"
      className="relative h-auto w-full flex-col items-stretch gap-0 overflow-hidden p-0 text-left whitespace-normal"
      disabled={!canAdd}
      onClick={onTap}
    >
      <span className="flex aspect-[4/3] items-center justify-center bg-muted">
        {product.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={product.imageUrl} alt="" loading="lazy" className="size-full object-cover" />
        ) : (
          <PackageIcon className="size-8 text-muted-foreground" aria-hidden />
        )}
      </span>
      <span className="flex flex-col gap-1 p-2">
        <span className="line-clamp-2 text-sm font-medium">{product.name}</span>
        <span className="text-sm tabular-nums">
          {cheapest === null ? (
            <span className="text-muted-foreground">{t("notInCurrency", { currency })}</span>
          ) : varies ? (
            t("from", { price: money(cheapest) })
          ) : (
            money(cheapest)
          )}
        </span>
        {soldOut ? (
          <Badge variant="destructive">{t("soldOut")}</Badge>
        ) : (
          stock !== null && stock <= 5 && <Badge variant="secondary">{t("left", { count: stock })}</Badge>
        )}
      </span>
      {inTicket > 0 && (
        <Badge className="absolute top-2 right-2 tabular-nums" aria-label={t("inTicket", { count: inTicket })}>
          {inTicket}
        </Badge>
      )}
    </Button>
  );
}

function VariantPicker({
  product,
  rows,
  currency,
  money,
  inTicket,
  onPick,
}: {
  product: PosProduct;
  rows: PosPrices[string];
  currency: string;
  money: (minor: number) => string;
  inTicket: (variantId: string) => number;
  onPick: (variant: PosVariant) => void;
}) {
  const t = useTranslations("Pos");
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">{product.name}</h2>
        <p className="text-sm text-muted-foreground">{t("pickVariant")}</p>
      </div>
      <ul className="grid gap-2 sm:grid-cols-2">
        {product.variants.map((variant) => {
          const price = rows[variant.id] ? resolvePrice(rows[variant.id], 1) : null;
          const full = variant.stock !== null && inTicket(variant.id) >= variant.stock;
          return (
            <li key={variant.id}>
              <Button
                variant="outline"
                className="h-auto w-full flex-col items-start gap-1 p-3 text-left whitespace-normal"
                disabled={!price || variant.stock === 0 || full}
                onClick={() => onPick(variant)}
              >
                <span className="font-medium">{variant.title ?? product.name}</span>
                <span className="text-sm tabular-nums">{price ? money(price.unitMinor) : t("notInCurrency", { currency })}</span>
                {variant.sku && <span className="text-xs text-muted-foreground">{variant.sku}</span>}
                {variant.stock === 0 ? (
                  <Badge variant="destructive">{t("soldOut")}</Badge>
                ) : (
                  variant.stock !== null && <span className="text-xs text-muted-foreground">{t("left", { count: variant.stock })}</span>
                )}
              </Button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function TicketPanel({
  lines,
  totalMinor,
  sellable,
  money,
  onQuantity,
  onClear,
  onCharge,
}: {
  lines: TicketLine[];
  totalMinor: number;
  sellable: boolean;
  money: (minor: number) => string;
  onQuantity: (variantId: string, quantity: number) => void;
  onClear: () => void;
  onCharge: () => void;
}) {
  const t = useTranslations("Pos");
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 overflow-y-auto p-4">
        {lines.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">{t("emptyTicket")}</p>
        ) : (
          <ul className="flex flex-col divide-y">
            {lines.map((line) => {
              const problem =
                line.unitMinor === null ? t("lineUnavailable") : line.stock !== null && line.quantity > line.stock ? t("onlyLeft", { count: line.stock }) : null;
              return (
                <li key={line.variantId} className="flex flex-col gap-2 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <span className="flex min-w-0 flex-col">
                      <span className="font-medium">{line.productName || t("lineUnavailable")}</span>
                      {line.variantTitle && <span className="text-sm text-muted-foreground">{line.variantTitle}</span>}
                      {line.unitMinor !== null && (
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {t("each", { price: money(line.unitMinor) })}
                          {line.compareAtMinor !== null && <s className="ml-1">{money(line.compareAtMinor)}</s>}
                        </span>
                      )}
                    </span>
                    <span className="font-medium tabular-nums">{money(line.lineTotalMinor)}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      size="icon"
                      variant="outline"
                      aria-label={t("less")}
                      onClick={() => onQuantity(line.variantId, line.quantity - 1)}
                    >
                      <MinusIcon />
                    </Button>
                    <Input
                      value={line.quantity}
                      onChange={(e) => {
                        const quantity = Number.parseInt(e.target.value.replace(/\D/g, ""), 10);
                        if (quantity >= 1) onQuantity(line.variantId, quantity);
                      }}
                      inputMode="numeric"
                      aria-label={t("quantity")}
                      className="h-8 w-16 text-center tabular-nums"
                    />
                    <Button
                      size="icon"
                      variant="outline"
                      aria-label={t("more")}
                      disabled={line.stock !== null && line.quantity >= line.stock}
                      onClick={() => onQuantity(line.variantId, line.quantity + 1)}
                    >
                      <PlusIcon />
                    </Button>
                    <Button size="icon" variant="ghost" className="ml-auto" aria-label={t("remove")} onClick={() => onQuantity(line.variantId, 0)}>
                      <Trash2Icon />
                    </Button>
                  </div>
                  {problem && (
                    <p role="alert" className="text-xs text-destructive">
                      {problem}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <div className="flex flex-col gap-3 border-t p-4">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-muted-foreground">{t("total")}</span>
          <span className="text-2xl font-semibold tabular-nums">{money(totalMinor)}</span>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="lg" disabled={lines.length === 0} onClick={onClear}>
            {t("clear")}
          </Button>
          <Button size="lg" className="h-12 flex-1 text-base" disabled={!sellable} onClick={onCharge}>
            {t("chargeButton", { total: money(totalMinor) })}
          </Button>
        </div>
      </div>
    </div>
  );
}
