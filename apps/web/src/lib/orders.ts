import type {
  ORDER_STATUSES as DB_ORDER_STATUSES,
  PAYMENT_KINDS as DB_PAYMENT_KINDS,
  PAYMENT_METHODS as DB_PAYMENT_METHODS,
  PAYMENT_STATUSES as DB_PAYMENT_STATUSES,
} from "@qvashop/db/schema";

// Client-safe copies of the order enums (the schema module pulls in the database driver).
// `satisfies` keeps them identical to the database CHECK lists.

export const ORDER_STATUSES = [
  "pending",
  "confirmed",
  "preparing",
  "ready",
  "out_for_delivery",
  "completed",
  "cancelled",
] as const satisfies typeof DB_ORDER_STATUSES;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const PAYMENT_STATUSES = ["unpaid", "partial", "paid", "refunded"] as const satisfies typeof DB_PAYMENT_STATUSES;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export function isOrderStatus(value: unknown): value is OrderStatus {
  return typeof value === "string" && (ORDER_STATUSES as readonly string[]).includes(value);
}

/** The normal path of an order (`out_for_delivery` only applies to delivery orders). */
const FLOW = ["pending", "confirmed", "preparing", "ready", "out_for_delivery", "completed"] as const;

/** `completed` and `cancelled` never change again. */
export function isFinalStatus(status: string): boolean {
  return status === "completed" || status === "cancelled";
}

/**
 * Where the merchant can move an order from `status`: any later step of its path (steps may
 * be skipped, e.g. a pickup completed on the spot), or `cancelled` while it is not final.
 * Never backwards. The first entry is the next step.
 */
export function nextStatuses(status: string, fulfillmentType: string): OrderStatus[] {
  if (!isOrderStatus(status) || isFinalStatus(status)) return [];
  const flow = FLOW.filter((step) => step !== "out_for_delivery" || fulfillmentType === "delivery");
  return [...flow.slice(flow.indexOf(status as (typeof FLOW)[number]) + 1), "cancelled"];
}

export function canChangeStatus(from: string, to: string, fulfillmentType: string): boolean {
  return (nextStatuses(from, fulfillmentType) as string[]).includes(to);
}

/**
 * Items can be lowered or removed until the order is handed over (`completed`) or
 * cancelled; after that, money goes back with a refund.
 */
export function canEditItems(status: string): boolean {
  return isOrderStatus(status) && !isFinalStatus(status);
}

/** The subtotal once each line has its new quantity (`quantities` by item id; lines not listed keep theirs). */
export function editedSubtotal(
  lines: { id: string; quantity: number; unitPriceMinor: number }[],
  quantities: ReadonlyMap<string, number>,
): number {
  return lines.reduce((sum, line) => sum + line.unitPriceMinor * (quantities.get(line.id) ?? line.quantity), 0);
}

export const PAYMENT_KINDS = ["payment", "refund"] as const satisfies typeof DB_PAYMENT_KINDS;
export type PaymentKind = (typeof PAYMENT_KINDS)[number];
export const PAYMENT_METHODS = ["cash", "transfer", "other"] as const satisfies typeof DB_PAYMENT_METHODS;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/**
 * Money of an order from its payment records: `net` = payments - refunds (what the store
 * keeps), `due` = what is still owed, `overpaid` = what must go back to the customer (more
 * was collected than the total, after an edit lowered it). Neither is ever negative.
 */
export function paymentTotals(totalMinor: number, payments: { kind: string; amountMinor: number }[]) {
  let paid = 0;
  let refunded = 0;
  for (const p of payments) {
    if (p.kind === "refund") refunded += p.amountMinor;
    else paid += p.amountMinor;
  }
  const net = paid - refunded;
  return { paid, refunded, net, due: Math.max(totalMinor - net, 0), overpaid: Math.max(net - totalMinor, 0) };
}

/** The cached `order.payment_status`, always derived from the payment records. */
export function paymentStatusOf(totalMinor: number, payments: { kind: string; amountMinor: number }[]): PaymentStatus {
  const { refunded, net } = paymentTotals(totalMinor, payments);
  if (refunded > 0 && net <= 0) return "refunded";
  if (net > 0 && net >= totalMinor) return "paid";
  if (net > 0) return "partial";
  return "unpaid";
}

/** Badge look per status: new orders stand out, finished ones fade. */
export function orderStatusVariant(status: string): "default" | "secondary" | "outline" | "destructive" {
  if (status === "pending") return "default";
  if (status === "cancelled") return "destructive";
  if (status === "completed") return "secondary";
  return "outline";
}

export function paymentStatusVariant(status: string): "default" | "secondary" | "outline" | "destructive" {
  if (status === "paid") return "secondary";
  if (status === "refunded") return "destructive";
  return "outline";
}

/** "Order #12" style reference shown everywhere (the column itself starts at 1). */
export function orderReference(number: number): string {
  return `#${number}`;
}
