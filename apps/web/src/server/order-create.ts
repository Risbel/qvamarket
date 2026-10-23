import { and, asc, customer, db, eq, inArray, order, orderItem, orderStatusHistory, productVariant, sql, store } from "@qvashop/db";
import { costIn } from "@/lib/inventory";
import type { OrderStatus } from "@/lib/orders";
import type { StoreCurrency } from "./currencies";
import { recordMovements } from "./inventory-ledger";

// The part of creating an order that the storefront checkout (checkout.ts) and the counter
// (pos.ts) share. It runs inside the caller's transaction, after the caller locked the store
// row and checked its idempotency key; amounts come from the caller's server-side pricing.

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Scope = { tenantId: string; storeId: string };

/** A priced line (unit price for its quantity, tiers and promotions applied). */
export type OrderLine = {
  variantId: string;
  name: string;
  variantTitle: string | null;
  quantity: number;
  unitPriceMinor: number;
  compareAtMinor: number | null;
  lineTotalMinor: number;
};

/** Thrown when a variant is gone or its stock is short: the caller rolls back and re-prices. */
export class OrderLinesChanged extends Error {
  constructor() {
    super("orderLinesChanged");
  }
}

/**
 * Takes the next order number, locks the variants and takes their stock (only where it is
 * tracked; a `sale` movement per line, and each line keeps the variant's unit cost), then
 * inserts the order, its items and the first history row. Throws OrderLinesChanged.
 */
export async function insertOrder(
  tx: Tx,
  scope: Scope,
  input: {
    lines: OrderLine[];
    currencyCode: string;
    /** the store's currencies, to snapshot each line's unit cost in the order's currency */
    currencies: StoreCurrency[];
    deliveryFeeMinor: number;
    order: Pick<
      typeof order.$inferInsert,
      | "customerId"
      | "userId"
      | "customerName"
      | "customerPhone"
      | "customerEmail"
      | "customerNote"
      | "fulfillmentType"
      | "idempotencyKey"
      | "channel"
      | "createdByUserId"
      | "registerSessionId"
    >;
    status: OrderStatus;
    history: { actor: "customer" | "merchant"; actorUserId: string | null };
  },
): Promise<{ id: string; number: number; subtotalMinor: number; totalMinor: number }> {
  const { tenantId, storeId } = scope;
  const [counter] = await tx
    .update(store)
    // keep updated_at: taking an order number is not an edit of the store
    .set({ lastOrderNumber: sql`${store.lastOrderNumber} + 1`, updatedAt: sql`${store.updatedAt}` })
    .where(and(eq(store.id, storeId), eq(store.tenantId, tenantId)))
    .returning({ number: store.lastOrderNumber });

  const variants = await tx
    .select({
      id: productVariant.id,
      productId: productVariant.productId,
      sku: productVariant.sku,
      stock: productVariant.stock,
      costMinor: productVariant.costMinor,
      costCurrencyCode: productVariant.costCurrencyCode,
    })
    .from(productVariant)
    .where(
      and(
        eq(productVariant.storeId, storeId),
        eq(productVariant.tenantId, tenantId),
        inArray(productVariant.id, input.lines.map((line) => line.variantId)),
      ),
    )
    // locked in id order, like cancelling an order, so the two cannot deadlock
    .orderBy(asc(productVariant.id))
    .for("no key update");
  const byId = new Map(variants.map((variant) => [variant.id, variant]));

  for (const line of input.lines) {
    const variant = byId.get(line.variantId);
    if (!variant) throw new OrderLinesChanged();
    if (variant.stock === null) continue;
    if (variant.stock < line.quantity) throw new OrderLinesChanged();
    await tx
      .update(productVariant)
      .set({ stock: sql`${productVariant.stock} - ${line.quantity}` })
      .where(and(eq(productVariant.id, variant.id), eq(productVariant.tenantId, tenantId)));
  }

  const subtotalMinor = input.lines.reduce((sum, line) => sum + line.lineTotalMinor, 0);
  const totalMinor = subtotalMinor + input.deliveryFeeMinor;
  const [created] = await tx
    .insert(order)
    .values({
      ...input.order,
      tenantId,
      storeId,
      number: counter.number,
      status: input.status,
      currencyCode: input.currencyCode,
      subtotalMinor,
      deliveryFeeMinor: input.deliveryFeeMinor,
      totalMinor,
    })
    .returning({ id: order.id });

  await tx.insert(orderItem).values(
    input.lines.map((line, position) => {
      const variant = byId.get(line.variantId)!;
      return {
        tenantId,
        storeId,
        orderId: created.id,
        variantId: variant.id,
        productId: variant.productId,
        position,
        productName: line.name,
        variantTitle: line.variantTitle,
        sku: variant.sku,
        quantity: line.quantity,
        unitPriceMinor: line.unitPriceMinor,
        compareAtMinor: line.compareAtMinor,
        lineTotalMinor: line.lineTotalMinor,
        stockDeducted: variant.stock !== null,
        unitCostMinor: costIn(
          variant.costMinor === null || variant.costCurrencyCode === null
            ? null
            : { minor: variant.costMinor, currencyCode: variant.costCurrencyCode },
          input.currencyCode,
          input.currencies,
        ),
      };
    }),
  );

  await recordMovements(
    tx,
    scope,
    input.lines.flatMap((line) => {
      const variant = byId.get(line.variantId)!;
      if (variant.stock === null) return [];
      return [
        {
          variantId: variant.id,
          reason: "sale" as const,
          delta: -line.quantity,
          stockAfter: variant.stock - line.quantity,
          orderId: created.id,
          actorUserId: input.history.actorUserId,
        },
      ];
    }),
  );

  await tx.insert(orderStatusHistory).values({
    tenantId,
    orderId: created.id,
    fromStatus: null,
    toStatus: input.status,
    actor: input.history.actor,
    actorUserId: input.history.actorUserId,
  });

  return { id: created.id, number: counter.number, subtotalMinor, totalMinor };
}

/**
 * A customer found again by phone (guest checkout, counter sale). Nothing typed here
 * overwrites the existing record: each order keeps its own copy of the contact details.
 */
export async function customerByPhone(
  tx: Tx,
  tenantId: string,
  contact: { name: string; phone: string; email: string | null },
): Promise<string> {
  const [buyer] = await tx
    .insert(customer)
    .values({ tenantId, name: contact.name, phone: contact.phone, email: contact.email })
    .onConflictDoUpdate({
      target: [customer.tenantId, customer.phone],
      targetWhere: sql`${customer.phone} is not null`,
      set: { updatedAt: sql`now()` },
    })
    .returning({ id: customer.id });
  return buyer.id;
}
