import { z } from "zod";
import { ORDER_STATUSES } from "@/lib/orders";
import type { Translator } from "./types";

/**
 * A status change asked by the merchant. `from` is the status the merchant was looking at:
 * the server refuses the change if the order has moved on since (another team member), so
 * nobody acts on a stale page. Whether `from -> to` is allowed is checked on the server
 * against the locked order (canChangeStatus).
 */
export function createOrderStatusSchema(t: Translator) {
  return z.object({
    from: z.enum(ORDER_STATUSES),
    to: z.enum(ORDER_STATUSES),
    note: z.string().trim().max(500, t("tooLong", { max: 500 })),
  });
}
export type OrderStatusValues = z.infer<ReturnType<typeof createOrderStatusSchema>>;
