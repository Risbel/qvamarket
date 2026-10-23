import { resolvePrice, type PriceRow } from "./pricing";

// Counter sales (point of sale): pure and client-safe. The POS screen prices its ticket with
// the same resolvePrice() as the server, from the price rows the page loaded; the server
// prices it again when charging and refuses if the total differs (`ticketChanged`).

/** Most units of one line at the counter (bulk sales are normal there). */
export const POS_MAX_QUANTITY = 9999;
export const POS_MAX_LINES = 100;
export const POS_MAX_PAYMENTS = 5;
export const POS_NOTE_MAX = 500;
export const POS_REFERENCE_MAX = 100;

/** A variant as the POS screen lists it (no prices: those are per currency). */
export type PosVariant = { id: string; title: string | null; sku: string | null; stock: number | null };
export type PosProduct = { id: string; name: string; imageKey: string | null; categoryId: string | null; variants: PosVariant[] };
export type PosCategory = { id: string; name: string };
/** Price rows per currency code, then per variant id. */
export type PosPrices = Record<string, Record<string, PriceRow[]>>;

export type TicketItem = { variantId: string; quantity: number };

export type TicketLine = {
  variantId: string;
  productName: string;
  variantTitle: string | null;
  quantity: number;
  /** null = not sold in this currency, or gone from the catalog */
  unitMinor: number | null;
  compareAtMinor: number | null;
  lineTotalMinor: number;
  /** stock left (null = not tracked) */
  stock: number | null;
};

/** The ticket priced in a currency (tiers and promotions applied per quantity). */
export function priceTicket(
  items: TicketItem[],
  products: PosProduct[],
  prices: Record<string, PriceRow[]>,
): { lines: TicketLine[]; totalMinor: number; sellable: boolean } {
  const variants = new Map(products.flatMap((p) => p.variants.map((v) => [v.id, { product: p, variant: v }] as const)));
  const lines = items.map((item): TicketLine => {
    const found = variants.get(item.variantId);
    const price = found ? resolvePrice(prices[item.variantId] ?? [], item.quantity) : null;
    return {
      variantId: item.variantId,
      productName: found?.product.name ?? "",
      variantTitle: found?.variant.title ?? null,
      quantity: item.quantity,
      unitMinor: price?.unitMinor ?? null,
      compareAtMinor: price?.compareAtMinor ?? null,
      lineTotalMinor: price ? price.unitMinor * item.quantity : 0,
      stock: found?.variant.stock ?? null,
    };
  });
  return {
    lines,
    totalMinor: lines.reduce((sum, line) => sum + line.lineTotalMinor, 0),
    sellable: lines.length > 0 && lines.every((l) => l.unitMinor !== null && (l.stock === null || l.quantity <= l.stock)),
  };
}

/** Adds `quantity` units of a variant (merging lines), capped at the stock and the line max. */
export function addToTicket(items: TicketItem[], variantId: string, stock: number | null, quantity = 1): TicketItem[] {
  const max = Math.min(stock ?? POS_MAX_QUANTITY, POS_MAX_QUANTITY);
  const current = items.find((i) => i.variantId === variantId);
  if (current) return items.map((i) => (i.variantId === variantId ? { ...i, quantity: Math.min(i.quantity + quantity, max) } : i));
  if (max < 1 || items.length >= POS_MAX_LINES) return items;
  return [...items, { variantId, quantity: Math.min(quantity, max) }];
}

/**
 * Bills a customer may hand over for `dueMinor`: the next round amounts above it (by 10, 50,
 * 100... major units), so the cashier taps instead of typing. Exact amount excluded.
 */
export function quickCashAmounts(dueMinor: number, digits: number): number[] {
  if (dueMinor <= 0) return [];
  const unit = 10 ** digits;
  const steps = [1, 5, 10, 20, 50, 100, 200, 500, 1000, 5000].map((s) => s * unit);
  const amounts = new Set<number>();
  for (const step of steps) {
    const rounded = Math.ceil(dueMinor / step) * step;
    if (rounded > dueMinor) amounts.add(rounded);
    if (amounts.size >= 4) break;
  }
  return [...amounts].sort((a, b) => a - b);
}

/** Text of a WhatsApp receipt (no markup; amounts already formatted). */
export function receiptText(input: {
  store: string;
  reference: string;
  lines: { name: string; quantity: number; total: string }[];
  total: string;
}): string {
  return [
    input.store,
    input.reference,
    "",
    ...input.lines.map((l) => `${l.quantity} x ${l.name}: ${l.total}`),
    "",
    input.total,
  ].join("\n");
}

/** Tickets set aside to serve the next customer (kept in the browser, per store). */
export const POS_MAX_PARKED = 10;
export type ParkedTicket = { id: string; currency: string; items: TicketItem[]; parkedAt: string };

/** Reads parked tickets back from storage, dropping anything malformed. */
export function parseParked(value: unknown): ParkedTicket[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (t): t is ParkedTicket =>
        Boolean(t) &&
        typeof t.id === "string" &&
        typeof t.currency === "string" &&
        typeof t.parkedAt === "string" &&
        Array.isArray(t.items) &&
        t.items.length > 0 &&
        t.items.every(
          (i: TicketItem) =>
            Boolean(i) && typeof i.variantId === "string" && Number.isInteger(i.quantity) && i.quantity >= 1 && i.quantity <= POS_MAX_QUANTITY,
        ),
    )
    .slice(0, POS_MAX_PARKED);
}
