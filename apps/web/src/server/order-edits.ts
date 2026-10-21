import { and, asc, db, eq, inArray, order, orderEdit, orderItem, orderPayment, productVariant, sql } from "@qvashop/db";
import type { OrderEditChange } from "@qvashop/db/schema";
import { canEditItems, editedSubtotal, paymentStatusOf, paymentTotals } from "@/lib/orders";
import type { OrderEditValues } from "@/lib/validation/order-edit";
import { recordMovements, type Movement } from "./inventory-ledger";

// Lowering or removing items of an order after checkout (the customer changed their mind at
// the counter, or a product was not really in stock). Every query matches tenant_id AND
// store_id (from requireMerchant(), never from client input).

type Scope = { tenantId: string; storeId: string };

export type EditOrderItemsResult =
  | { ok: true; restockedUnits: number; overpaidMinor: number }
  | { ok: false; error: "notFound" | "stale" | "notAllowed" | "empty" };

/**
 * Applies an edit in one transaction: locks the order (so a payment, a status change or
 * another edit cannot run at the same time), refuses `stale` when a line no longer has the
 * quantity the page showed, lowers the lines (a removed line stays with quantity 0 and its
 * original quantity), gives the removed units back to the stock where asked and checkout
 * took them, recomputes subtotal, total and payment status, and records the edit. The
 * delivery fee stays as charged. If more was collected than the new total, the merchant
 * records the refund (`overpaidMinor`).
 */
export async function editOrderItems(
  scope: Scope,
  orderId: string,
  input: OrderEditValues & { userId: string },
): Promise<EditOrderItemsResult> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ status: order.status, subtotalMinor: order.subtotalMinor, deliveryFeeMinor: order.deliveryFeeMinor })
      .from(order)
      .where(and(eq(order.tenantId, scope.tenantId), eq(order.storeId, scope.storeId), eq(order.id, orderId)))
      .for("no key update");
    if (!row) return { ok: false, error: "notFound" };
    if (!canEditItems(row.status)) return { ok: false, error: "notAllowed" };

    const items = await tx
      .select({
        id: orderItem.id,
        variantId: orderItem.variantId,
        productName: orderItem.productName,
        variantTitle: orderItem.variantTitle,
        quantity: orderItem.quantity,
        originalQuantity: orderItem.originalQuantity,
        unitPriceMinor: orderItem.unitPriceMinor,
        stockDeducted: orderItem.stockDeducted,
      })
      .from(orderItem)
      .where(and(eq(orderItem.orderId, orderId), eq(orderItem.tenantId, scope.tenantId), eq(orderItem.storeId, scope.storeId)));
    const byId = new Map(items.map((item) => [item.id, item]));

    const changed = [];
    for (const line of input.lines) {
      const item = byId.get(line.itemId);
      if (!item || item.quantity !== line.from) return { ok: false, error: "stale" };
      if (line.to < line.from) changed.push({ ...line, item });
    }
    if (changed.length === 0) return { ok: false, error: "stale" };
    const quantities = new Map(changed.map((line) => [line.itemId, line.to]));
    if (items.every((item) => (quantities.get(item.id) ?? item.quantity) === 0)) return { ok: false, error: "empty" };

    // Stock goes back only for units checkout took, to variants that still exist and still
    // track stock; locked in id order like checkout and cancel, so they cannot deadlock
    const restockIds = [
      ...new Set(changed.flatMap((line) => (line.restock && line.item.stockDeducted && line.item.variantId ? [line.item.variantId] : []))),
    ];
    // stock of each tracked variant, followed line by line for the movements
    const stock = new Map<string, number>();
    if (restockIds.length > 0) {
      const variants = await tx
        .select({ id: productVariant.id, stock: productVariant.stock })
        .from(productVariant)
        .where(
          and(
            eq(productVariant.tenantId, scope.tenantId),
            eq(productVariant.storeId, scope.storeId),
            inArray(productVariant.id, restockIds),
          ),
        )
        .orderBy(asc(productVariant.id))
        .for("no key update");
      for (const variant of variants) if (variant.stock !== null) stock.set(variant.id, variant.stock);
    }

    const changes: OrderEditChange[] = [];
    let restockedUnits = 0;
    const movements: Movement[] = [];
    for (const { item, from, to, restock } of changed) {
      const restockId = restock && item.stockDeducted && item.variantId && stock.has(item.variantId) ? item.variantId : null;
      const restocked = restockId ? from - to : 0;
      if (restockId) {
        await tx
          .update(productVariant)
          .set({ stock: sql`${productVariant.stock} + ${restocked}` })
          .where(and(eq(productVariant.id, restockId), eq(productVariant.tenantId, scope.tenantId)));
        const stockAfter = stock.get(restockId)! + restocked;
        stock.set(restockId, stockAfter);
        movements.push({ variantId: restockId, reason: "order_edit", delta: restocked, stockAfter, orderId, actorUserId: input.userId });
        restockedUnits += restocked;
      }
      await tx
        .update(orderItem)
        .set({
          quantity: to,
          lineTotalMinor: item.unitPriceMinor * to,
          originalQuantity: item.originalQuantity ?? from,
          // nothing left on the line: a later cancel must not give anything back for it
          ...(to === 0 ? { stockDeducted: false } : {}),
        })
        .where(and(eq(orderItem.id, item.id), eq(orderItem.tenantId, scope.tenantId)));
      changes.push({ itemId: item.id, productName: item.productName, variantTitle: item.variantTitle, from, to, restocked });
    }

    await recordMovements(tx, scope, movements);

    const subtotalMinor = editedSubtotal(items, quantities);
    const totalMinor = subtotalMinor + row.deliveryFeeMinor;
    const payments = await tx
      .select({ kind: orderPayment.kind, amountMinor: orderPayment.amountMinor })
      .from(orderPayment)
      .where(and(eq(orderPayment.orderId, orderId), eq(orderPayment.tenantId, scope.tenantId)));
    await tx
      .update(order)
      .set({ subtotalMinor, totalMinor, paymentStatus: paymentStatusOf(totalMinor, payments) })
      .where(and(eq(order.tenantId, scope.tenantId), eq(order.storeId, scope.storeId), eq(order.id, orderId)));
    await tx.insert(orderEdit).values({
      tenantId: scope.tenantId,
      orderId,
      actorUserId: input.userId,
      changes,
      subtotalBeforeMinor: row.subtotalMinor,
      subtotalAfterMinor: subtotalMinor,
      note: input.note || null,
    });
    return { ok: true, restockedUnits, overpaidMinor: paymentTotals(totalMinor, payments).overpaid };
  });
}
