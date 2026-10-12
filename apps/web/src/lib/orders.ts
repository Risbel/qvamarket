import type {
  ORDER_STATUSES as DB_ORDER_STATUSES,
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
