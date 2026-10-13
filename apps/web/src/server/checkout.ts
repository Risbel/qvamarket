import { and, asc, customer, db, eq, inArray, order, orderDelivery, orderItem, orderStatusHistory, productVariant, sql, store } from "@qvashop/db";
import type { CartItem } from "@/lib/cart";
import { deliveryFee, distanceMeters, insideArea } from "@/lib/delivery";
import type { LatLng } from "@/lib/map";
import { priceCart } from "./cart";
import { getPublicDelivery } from "./public-delivery";

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

/** How the order reaches the customer, as chosen at checkout. */
export type CheckoutFulfillment =
  | { type: "pickup" }
  | {
      type: "delivery";
      /** the customer's pin */
      location: LatLng;
      /** street, number, references, as typed */
      address: string;
      /** the fee the customer saw (compared, never used as an amount) */
      expectedFeeMinor: number;
    };

type AbortReason =
  | "cartChanged"
  | "storeClosed"
  | "pickupUnavailable"
  | "deliveryUnavailable"
  | "outsideArea"
  | "belowMinimum"
  | "deliveryChanged";

export type PlaceOrderResult = { ok: true; orderId: string } | { ok: false; error: "empty" | AbortReason };

/** Thrown inside the transaction to roll it back (nothing is kept, not even the number). */
class CheckoutAbort extends Error {
  constructor(readonly reason: AbortReason) {
    super(reason);
  }
}

/**
 * Creates an order (pickup or home delivery) from the shopper's cart. Amounts come only from priceCart() (the
 * browser sends ids and quantities; `expectedSubtotalMinor` is just what the customer saw,
 * and any difference, a changed line or a missing stock answers `cartChanged` so the
 * customer reviews the new amounts before ordering). One transaction:
 *   1. lock the store row (serializes this store's checkouts and its settings saves) and honor
 *      the idempotency key; check the chosen fulfillment against the store's delivery
 *      settings read now: pickup must be on; delivery must be on, the pin inside the service
 *      area, the subtotal above the minimum, and the fee (computed here) the one the customer
 *      saw, otherwise `deliveryChanged`
 *   2. take the next order number
 *   3. lock the variants and take their stock (only where stock is tracked)
 *   4. find the customer (the signed-in account's record, or by phone for a guest), insert
 *      order, items and the first history row
 */
export async function placeOrder(input: {
  storeId: string;
  currencyCode: string;
  items: CartItem[];
  contact: CheckoutContact;
  expectedSubtotalMinor: number;
  idempotencyKey: string;
  /** the customer account signed in on this store's host; null = guest checkout */
  accountUserId: string | null;
  fulfillment: CheckoutFulfillment;
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

      const shipping = await deliveryForOrder(tx, storeId, currencyCode, cart.subtotalMinor, input.fulfillment);

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
        // locked in id order, like cancelling an order, so the two cannot deadlock
        .orderBy(asc(productVariant.id))
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

      const customerId = input.accountUserId
        ? await accountCustomer(tx, tenantId, input.accountUserId, contact)
        : await guestCustomer(tx, tenantId, contact);

      const [created] = await tx
        .insert(order)
        .values({
          tenantId,
          storeId,
          number: counter.number,
          customerId,
          userId: input.accountUserId,
          customerName: contact.name,
          customerPhone: contact.phone,
          customerEmail: contact.email,
          customerNote: contact.note,
          fulfillmentType: input.fulfillment.type,
          currencyCode,
          subtotalMinor: cart.subtotalMinor,
          deliveryFeeMinor: shipping?.feeMinor ?? 0,
          totalMinor: cart.subtotalMinor + (shipping?.feeMinor ?? 0),
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

      if (shipping) {
        await tx.insert(orderDelivery).values({ orderId: created.id, tenantId, storeId, ...shipping.snapshot });
      }

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

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Checks the chosen fulfillment against the store's delivery settings (read inside the
 * order's transaction) and, for delivery, returns the fee and the snapshot to store.
 */
async function deliveryForOrder(tx: Tx, storeId: string, currencyCode: string, subtotalMinor: number, fulfillment: CheckoutFulfillment) {
  const options = await getPublicDelivery(storeId, tx);
  if (fulfillment.type === "pickup") {
    if (!options.pickupEnabled) throw new CheckoutAbort("pickupUnavailable");
    return null;
  }
  const delivery = options.delivery;
  if (!delivery) throw new CheckoutAbort("deliveryUnavailable");
  if (!insideArea(fulfillment.location, delivery.area)) throw new CheckoutAbort("outsideArea");
  const distanceM = Math.round(distanceMeters(delivery.location, fulfillment.location));
  const quote = deliveryFee(delivery, delivery.rates[currencyCode] ?? null, distanceM, subtotalMinor);
  if (!quote.ok) throw new CheckoutAbort(quote.reason === "noRate" ? "deliveryUnavailable" : "belowMinimum");
  if (quote.feeMinor !== fulfillment.expectedFeeMinor) throw new CheckoutAbort("deliveryChanged");
  return {
    feeMinor: quote.feeMinor,
    snapshot: {
      address: fulfillment.address,
      locationLat: fulfillment.location.lat,
      locationLng: fulfillment.location.lng,
      distanceM,
      feeMode: delivery.mode,
    },
  };
}

/**
 * Guest checkout: the customer is found again by phone. Nothing typed here overwrites the
 * existing record: each order keeps its own copy of the contact details.
 */
async function guestCustomer(tx: Tx, tenantId: string, contact: CheckoutContact): Promise<string> {
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

/**
 * Signed-in checkout: the account's own record in this company (created if missing). It
 * takes the phone of the order when it has none yet, unless another record of the company
 * already has that number: that record may be someone else's (a typed phone proves
 * nothing), so records are never merged and the guest record stays as it is.
 */
async function accountCustomer(tx: Tx, tenantId: string, userId: string, contact: CheckoutContact): Promise<string> {
  const [mine] = await tx
    .insert(customer)
    .values({ tenantId, userId, name: contact.name, email: contact.email })
    .onConflictDoUpdate({
      target: [customer.tenantId, customer.userId],
      targetWhere: sql`${customer.userId} is not null`,
      set: { updatedAt: sql`now()` },
    })
    .returning({ id: customer.id, phone: customer.phone });
  if (mine.phone === null) {
    try {
      // A savepoint: if a checkout of another store of the company takes the number at the
      // same moment, only this optional step is undone, not the order
      await tx.transaction(async (savepoint) => {
        await savepoint
          .update(customer)
          .set({ phone: contact.phone })
          .where(
            and(
              eq(customer.id, mine.id),
              eq(customer.tenantId, tenantId),
              sql`${customer.phone} is null`,
              sql`not exists (select 1 from customer other where other.tenant_id = ${tenantId} and other.phone = ${contact.phone})`,
            ),
          );
      });
    } catch (error) {
      console.warn("could not save the phone on the account's customer record", error);
    }
  }
  return mine.id;
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
      // only compared with the viewer's session (never shown)
      userId: order.userId,
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

  const [delivery] =
    row.fulfillmentType === "delivery"
      ? await db
          .select({ address: orderDelivery.address, distanceM: orderDelivery.distanceM })
          .from(orderDelivery)
          .where(and(eq(orderDelivery.orderId, row.id), eq(orderDelivery.storeId, storeId)))
      : [];

  return { ...row, items, delivery: delivery ?? null };
}
