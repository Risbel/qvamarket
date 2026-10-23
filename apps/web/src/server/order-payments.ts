import { and, db, eq, order, orderPayment } from "@qvashop/db";
import { paymentStatusOf, paymentTotals } from "@/lib/orders";
import type { PaymentInput } from "@/lib/validation/payment";
import { inClosedPeriod } from "./register";

// Payments recorded by hand on an order of the merchant's store. Every query matches
// tenant_id AND store_id (from requireMerchant(), never from client input).

type Scope = { tenantId: string; storeId: string };
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type RecordPaymentResult =
  | { ok: true }
  | { ok: false; error: "notFound" | "cancelled" | "closedPeriod" }
  /** the amount is over the limit, which is returned (what is owed, or what was collected) */
  | { ok: false; error: "exceedsDue" | "exceedsPaid"; limitMinor: number };

export type DeletePaymentResult = { ok: true } | { ok: false; error: "notFound" | "unbalanced" | "closedPeriod" };

/**
 * Locks the order (so two people recording at once cannot both pay what is owed) and
 * returns it with its payment records.
 */
async function lockOrder(tx: Tx, scope: Scope, orderId: string) {
  const [row] = await tx
    .select({ status: order.status, totalMinor: order.totalMinor })
    .from(order)
    .where(and(eq(order.tenantId, scope.tenantId), eq(order.storeId, scope.storeId), eq(order.id, orderId)))
    .for("no key update");
  if (!row) return null;
  const payments = await tx
    .select({ id: orderPayment.id, kind: orderPayment.kind, amountMinor: orderPayment.amountMinor, paidAt: orderPayment.paidAt })
    .from(orderPayment)
    .where(and(eq(orderPayment.orderId, orderId), eq(orderPayment.tenantId, scope.tenantId)));
  return { ...row, payments };
}

/** Refreshes the cached order.payment_status from the records (same transaction). */
async function savePaymentStatus(
  tx: Tx,
  scope: Scope,
  orderId: string,
  totalMinor: number,
  payments: { kind: string; amountMinor: number }[],
) {
  await tx
    .update(order)
    .set({ paymentStatus: paymentStatusOf(totalMinor, payments) })
    .where(and(eq(order.tenantId, scope.tenantId), eq(order.storeId, scope.storeId), eq(order.id, orderId)));
}

/**
 * Records money received (`payment`, at most what is still owed) or given back (`refund`,
 * at most what was collected), so the balance always stays between 0 and the total.
 * A cancelled order takes refunds only.
 */
export async function recordPayment(
  scope: Scope,
  orderId: string,
  input: PaymentInput & { userId: string },
): Promise<RecordPaymentResult> {
  return db.transaction(async (tx) => {
    const locked = await lockOrder(tx, scope, orderId);
    if (!locked) return { ok: false, error: "notFound" };
    if (input.kind === "payment" && locked.status === "cancelled") return { ok: false, error: "cancelled" };
    const { due, net } = paymentTotals(locked.totalMinor, locked.payments);
    if (input.kind === "payment" && input.amountMinor > due) return { ok: false, error: "exceedsDue", limitMinor: due };
    if (input.kind === "refund" && input.amountMinor > net) return { ok: false, error: "exceedsPaid", limitMinor: net };
    // "now" is taken after the register lock, so it can never land inside a session that was
    // being closed while this waited; a date in a closed day is refused
    const paidAt = input.paidAt ?? new Date();
    if (await inClosedPeriod(tx, scope, [paidAt])) return { ok: false, error: "closedPeriod" };

    await tx.insert(orderPayment).values({
      tenantId: scope.tenantId,
      orderId,
      kind: input.kind,
      method: input.method,
      amountMinor: input.amountMinor,
      paidAt,
      recordedByUserId: input.userId,
      note: input.note || null,
    });
    await savePaymentStatus(tx, scope, orderId, locked.totalMinor, [...locked.payments, input]);
    return { ok: true };
  });
}

/**
 * Removes a record entered by mistake. Refused (`unbalanced`) when the balance would leave
 * 0..total, e.g. removing a payment that a later refund gave back. After an edit lowered the
 * total the balance can already be above it: removing a payment (towards the total) is
 * still fine, removing a refund (further above) is not.
 */
export async function deletePayment(scope: Scope, orderId: string, paymentId: string): Promise<DeletePaymentResult> {
  return db.transaction(async (tx) => {
    const locked = await lockOrder(tx, scope, orderId);
    const target = locked?.payments.find((p) => p.id === paymentId);
    if (!locked || !target) return { ok: false, error: "notFound" };
    // a record of a closed day is part of its frozen report: correct it with a new record instead
    if (await inClosedPeriod(tx, scope, [target.paidAt])) return { ok: false, error: "closedPeriod" };
    const remaining = locked.payments.filter((p) => p.id !== paymentId);
    const { net } = paymentTotals(locked.totalMinor, remaining);
    const before = paymentTotals(locked.totalMinor, locked.payments).net;
    if (net < 0 || (net > locked.totalMinor && net > before)) return { ok: false, error: "unbalanced" };

    await tx
      .delete(orderPayment)
      .where(and(eq(orderPayment.id, paymentId), eq(orderPayment.orderId, orderId), eq(orderPayment.tenantId, scope.tenantId)));
    await savePaymentStatus(tx, scope, orderId, locked.totalMinor, remaining);
    return { ok: true };
  });
}

/** The order's currency (payments are always in it); null when not this store's order. */
export async function orderCurrency(scope: Scope, orderId: string): Promise<string | null> {
  const [row] = await db
    .select({ currencyCode: order.currencyCode })
    .from(order)
    .where(and(eq(order.tenantId, scope.tenantId), eq(order.storeId, scope.storeId), eq(order.id, orderId)))
    .limit(1);
  return row?.currencyCode ?? null;
}
