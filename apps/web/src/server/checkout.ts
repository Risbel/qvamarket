import { and, asc, customer, db, eq, inArray, order, orderItem, orderStatusHistory, productVariant, sql, store } from "@qvashop/db";
import type { CartItem } from "@/lib/cart";
import { priceCart } from "./cart";

// Public writes of the storefront (checkout) and the order confirmation. Like
// public-store.ts / public-catalog.ts they run for an anonymous visitor, so all safety is in
// the queries: the store is the public one found by slug (status active), every row is
// matched by store id, and tenant_id is read from the store row here and never leaves this
// file.

export type CheckoutContact = {
  name: string;
  /** already normalized with normalizePhone() */
  phone: string;
  email: string | null;
  note: string | null;
};

export type PlaceOrderResult =
  | { ok: true; orderId: string }
  | { ok: false; error: "empty" | "cartChanged" | "storeClosed" };

/** Thrown inside the transaction to roll it back (nothing is kept, not even the number). */
class CheckoutAbort extends Error {
  constructor(readonly reason: "cartChanged" | "storeClosed") {
    super(reason);
  }
}

/**
 * Creates a pickup order from the shopper's cart. Amounts come only from priceCart() (the
 * browser sends ids and quantities; `expectedSubtotalMinor` is just what the customer saw,
 * and any difference, a changed line or a missing stock answers `cartChanged` so the
 * customer reviews the new amounts before ordering). One transaction:
 *   1. lock the store row (serializes this store's checkouts) and honor the idempotency key
 *   2. take the next order number
 *   3. lock the variants and take their stock (only where stock is tracked)
 *   4. find or create the customer by phone, insert order, items and the first history row
 */
export async function placeOrder(input: {
  storeId: string;
  currencyCode: string;
  items: CartItem[];
  contact: CheckoutContact;
  expectedSubtotalMinor: number;
  idempotencyKey: string;
}): Promise<PlaceOrderResult> {
  const { storeId, currencyCode, contact, idempotencyKey } = input;

  const existing = await orderByIdempotencyKey(storeId, idempotencyKey);
  if (existing) return { ok: true, orderId: existing };
  if (input.items.length === 0) return { ok: false, error: "empty" };

  const cart = await priceCart(storeId, currencyCode, input.items);
  if (
    cart.lines.length === 0 ||
    cart.lines.some((line) => line.status !== "ok") ||
    cart.subtotalMinor !== input.expectedSubtotalMinor
  ) {
    return { ok: false, error: "cartChanged" };
  }

  try {
    const orderId = await db.transaction(async (tx) => {
      const [locked] = await tx
        .select({ tenantId: store.tenantId })
        .from(store)
        .where(and(eq(store.id, storeId), eq(store.status, "active")))
        .for("no key update");
      if (!locked) throw new CheckoutAbort("storeClosed");
      const { tenantId } = locked;

      // A retried submit that waited for the lock finds the order the first one created
      const [again] = await tx
        .select({ id: order.id })
        .from(order)
        .where(and(eq(order.storeId, storeId), eq(order.idempotencyKey, idempotencyKey)));
      if (again) return again.id;

      const [counter] = await tx
        .update(store)
        // keep updated_at: taking an order number is not an edit of the store
        .set({ lastOrderNumber: sql`${store.lastOrderNumber} + 1`, updatedAt: sql`${store.updatedAt}` })
        .where(and(eq(store.id, storeId), eq(store.tenantId, tenantId)))
        .returning({ number: store.lastOrderNumber });

      const variants = await tx
        .select({ id: productVariant.id, productId: productVariant.productId, sku: productVariant.sku, stock: productVariant.stock })
        .from(productVariant)
        .where(
          and(
            eq(productVariant.storeId, storeId),
            eq(productVariant.tenantId, tenantId),
            inArray(productVariant.id, cart.lines.map((line) => line.variantId)),
          ),
        )
        .for("no key update");
      const byId = new Map(variants.map((variant) => [variant.id, variant]));

      for (const line of cart.lines) {
        const variant = byId.get(line.variantId);
        if (!variant) throw new CheckoutAbort("cartChanged");
        if (variant.stock === null) continue;
        if (variant.stock < line.quantity) throw new CheckoutAbort("cartChanged");
        await tx
          .update(productVariant)
          .set({ stock: sql`${productVariant.stock} - ${line.quantity}` })
          .where(and(eq(productVariant.id, variant.id), eq(productVariant.tenantId, tenantId)));
      }

      // Found again by phone. Nothing typed here overwrites the existing record: each order
      // keeps its own copy of the contact details.
      const [buyer] = await tx
        .insert(customer)
        .values({ tenantId, name: contact.name, phone: contact.phone, email: contact.email })
        .onConflictDoUpdate({
          target: [customer.tenantId, customer.phone],
          targetWhere: sql`${customer.phone} is not null`,
          set: { updatedAt: sql`now()` },
        })
        .returning({ id: customer.id });

      const [created] = await tx
        .insert(order)
        .values({
          tenantId,
          storeId,
          number: counter.number,
          customerId: buyer.id,
          customerName: contact.name,
          customerPhone: contact.phone,
          customerEmail: contact.email,
          customerNote: contact.note,
          fulfillmentType: "pickup",
          currencyCode,
          subtotalMinor: cart.subtotalMinor,
          deliveryFeeMinor: 0,
          totalMinor: cart.subtotalMinor,
          idempotencyKey,
        })
        .returning({ id: order.id });

      await tx.insert(orderItem).values(
        cart.lines.map((line, position) => {
          const variant = byId.get(line.variantId)!;
          return {
            tenantId,
            storeId,
            orderId: created.id,
            variantId: variant.id,
            productId: variant.productId,
            position,
            productName: line.name ?? "",
            variantTitle: line.variantTitle,
            sku: variant.sku,
            quantity: line.quantity,
            unitPriceMinor: line.unitPriceMinor,
            compareAtMinor: line.compareAtMinor,
            lineTotalMinor: line.lineTotalMinor,
            stockDeducted: variant.stock !== null,
          };
        }),
      );

      await tx.insert(orderStatusHistory).values({
        tenantId,
        orderId: created.id,
        fromStatus: null,
        toStatus: "pending",
        actor: "customer",
      });

      return created.id;
    });
    return { ok: true, orderId };
  } catch (error) {
    if (error instanceof CheckoutAbort) return { ok: false, error: error.reason };
    throw error;
  }
}

async function orderByIdempotencyKey(storeId: string, key: string) {
  const [row] = await db
    .select({ id: order.id })
    .from(order)
    .where(and(eq(order.storeId, storeId), eq(order.idempotencyKey, key)))
    .limit(1);
  return row?.id ?? null;
}

/**
 * An order as its confirmation page shows it. The id (random UUID) is the key, and the order
 * must belong to the store of the subdomain it is opened on.
 */
export async function getPublicOrder(storeId: string, orderId: string) {
  const [row] = await db
    .select({
      id: order.id,
      number: order.number,
      createdAt: order.createdAt,
      customerName: order.customerName,
      customerPhone: order.customerPhone,
      customerEmail: order.customerEmail,
      customerNote: order.customerNote,
      fulfillmentType: order.fulfillmentType,
      currencyCode: order.currencyCode,
      subtotalMinor: order.subtotalMinor,
      deliveryFeeMinor: order.deliveryFeeMinor,
      totalMinor: order.totalMinor,
    })
    .from(order)
    .where(and(eq(order.id, orderId), eq(order.storeId, storeId)))
    .limit(1);
  if (!row) return null;

  const items = await db
    .select({
      id: orderItem.id,
      productName: orderItem.productName,
      variantTitle: orderItem.variantTitle,
      quantity: orderItem.quantity,
      unitPriceMinor: orderItem.unitPriceMinor,
      compareAtMinor: orderItem.compareAtMinor,
      lineTotalMinor: orderItem.lineTotalMinor,
    })
    .from(orderItem)
    .where(and(eq(orderItem.orderId, row.id), eq(orderItem.storeId, storeId)))
    .orderBy(asc(orderItem.position));

  return { ...row, items };
}
