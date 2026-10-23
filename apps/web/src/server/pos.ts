import { and, asc, category, db, eq, inArray, order, orderPayment, product, productVariant, sql, store } from "@qvashop/db";
import type { CartItem } from "@/lib/cart";
import { paymentStatusOf, type PaymentMethod } from "@/lib/orders";
import { POS_MAX_QUANTITY, type PosCategory, type PosPrices, type PosProduct } from "@/lib/pos";
import { priceItems } from "./cart";
import { customerByPhone, insertOrder, OrderLinesChanged } from "./order-create";
import { loadPriceRows, storeCurrencies } from "./pricing";
import type { PublicCartVariant } from "./public-catalog";
import { openShiftOf } from "./register";

// Counter sales (point of sale) of the merchant's store. Every function takes the scope from
// requireMerchant() / getMerchantOrNull() and filters by tenant_id AND store_id. The counter
// sells the store's active products whatever the store's status (a pending store can still
// sell in its shop); prices are the same as the storefront's (loadPriceRows + resolvePrice).

type Scope = { tenantId: string; storeId: string };

const mainImage = sql<string | null>`(
  select pi.storage_key from product_image pi
  where pi.product_id = ${product.id} and pi.tenant_id = ${product.tenantId}
  order by pi.position asc limit 1
)`;

const sellable = ({ tenantId, storeId }: Scope) =>
  and(eq(product.tenantId, tenantId), eq(product.storeId, storeId), eq(product.status, "active"));

/**
 * What the POS screen needs: categories in the merchant's order (hidden ones too: they still
 * sell at the counter), active products with their variants, and the price rows of every
 * variant in each of the store's currencies (the screen prices the ticket with them).
 */
export async function listPosCatalog(
  scope: Scope,
): Promise<{ categories: PosCategory[]; products: PosProduct[]; prices: PosPrices; phoneCountry: string | null }> {
  const [[settings], categories, products] = await Promise.all([
    db
      .select({ phoneCountry: store.phoneCountry })
      .from(store)
      .where(and(eq(store.id, scope.storeId), eq(store.tenantId, scope.tenantId))),
    db
      .select({ id: category.id, name: category.name })
      .from(category)
      .where(and(eq(category.tenantId, scope.tenantId), eq(category.storeId, scope.storeId)))
      .orderBy(asc(category.position), asc(category.name)),
    db
      .select({ id: product.id, name: product.name, categoryId: product.categoryId, imageKey: mainImage })
      .from(product)
      .where(sellable(scope))
      .orderBy(sql`${product.name} collate "und-x-icu"`),
  ]);
  const variants = products.length
    ? await db
        .select({
          id: productVariant.id,
          productId: productVariant.productId,
          title: productVariant.title,
          sku: productVariant.sku,
          stock: productVariant.stock,
        })
        .from(productVariant)
        .where(
          and(
            eq(productVariant.tenantId, scope.tenantId),
            eq(productVariant.storeId, scope.storeId),
            inArray(productVariant.productId, products.map((p) => p.id)),
          ),
        )
        .orderBy(asc(productVariant.position))
    : [];

  const ids = variants.map((v) => v.id);
  const prices: PosPrices = {};
  for (const currency of await storeCurrencies(scope.storeId)) {
    prices[currency.code] = Object.fromEntries(await loadPriceRows(scope.storeId, ids, currency.code));
  }
  return {
    phoneCountry: settings?.phoneCountry ?? null,
    categories,
    products: products.map((p) => ({
      ...p,
      variants: variants.filter((v) => v.productId === p.id).map(({ id, title, sku, stock }) => ({ id, title, sku, stock })),
    })),
    prices,
  };
}

/** Variants the counter may sell (active products of this store), keyed by id. */
async function posVariants(scope: Scope, ids: string[]): Promise<Map<string, PublicCartVariant>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({
      id: productVariant.id,
      productId: product.id,
      productSlug: product.slug,
      name: product.name,
      title: productVariant.title,
      stock: productVariant.stock,
      imageKey: mainImage,
    })
    .from(productVariant)
    .innerJoin(
      product,
      and(eq(product.id, productVariant.productId), eq(product.storeId, productVariant.storeId), eq(product.tenantId, productVariant.tenantId)),
    )
    .where(and(sellable(scope), inArray(productVariant.id, ids)));
  return new Map(rows.map((row) => [row.id, row]));
}

export type PosPayment = { method: PaymentMethod; amountMinor: number; reference: string | null };

export type PosSaleResult =
  | { ok: true; orderId: string }
  | { ok: false; error: "ticketChanged" | "noShift" | "paidTooMuch" | "paidTooLittle" };

/**
 * A counter sale: an order made by `userId` (channel `pos`, pickup, completed at once) with
 * its payments, in one transaction. The ticket is priced here (`expectedTotalMinor` is only
 * what the cashier saw: any difference, a line not sold any more or short stock answers
 * `ticketChanged`). The order and its payments go to the cashier's open register shift;
 * with `requireShift` (the plan has day close) there must be one (`noShift`). Payments may
 * add up to less than the total only with `payLater` (the rest stays owed on the order).
 * The customer is optional: with a phone it is found again (or created) like at checkout.
 */
export async function placePosSale(
  scope: Scope,
  input: {
    currencyCode: string;
    items: CartItem[];
    expectedTotalMinor: number;
    idempotencyKey: string;
    payments: PosPayment[];
    payLater: boolean;
    customer: { name: string; phone: string | null };
    note: string | null;
  },
  seller: { userId: string; requireShift: boolean },
): Promise<PosSaleResult> {
  const existing = await saleByIdempotencyKey(scope, input.idempotencyKey);
  if (existing) return { ok: true, orderId: existing };

  const variants = await posVariants(scope, input.items.map((i) => i.variantId));
  const ticket = await priceItems(scope.storeId, input.currencyCode, input.items, variants, POS_MAX_QUANTITY);
  if (ticket.lines.some((line) => line.status !== "ok") || ticket.subtotalMinor !== input.expectedTotalMinor) {
    return { ok: false, error: "ticketChanged" };
  }
  const paid = input.payments.reduce((sum, p) => sum + p.amountMinor, 0);
  if (paid > ticket.subtotalMinor) return { ok: false, error: "paidTooMuch" };
  if (paid < ticket.subtotalMinor && !input.payLater) return { ok: false, error: "paidTooLittle" };
  const currencies = await storeCurrencies(scope.storeId);

  try {
    return await db.transaction(async (tx) => {
      // serializes the store's order numbers (like checkout) and retried submits
      await tx
        .select({ id: store.id })
        .from(store)
        .where(and(eq(store.id, scope.storeId), eq(store.tenantId, scope.tenantId)))
        .for("no key update");
      const [again] = await tx
        .select({ id: order.id })
        .from(order)
        .where(and(eq(order.storeId, scope.storeId), eq(order.idempotencyKey, input.idempotencyKey)));
      if (again) return { ok: true, orderId: again.id } as const;

      // taken FOR SHARE: a close of this shift waits for the sale (or the sale sees it closed)
      const registerSessionId = await openShiftOf(tx, scope, seller.userId);
      if (seller.requireShift && !registerSessionId) return { ok: false, error: "noShift" } as const;

      const customerId = input.customer.phone
        ? await customerByPhone(tx, scope.tenantId, { name: input.customer.name, phone: input.customer.phone, email: null })
        : null;

      const created = await insertOrder(tx, scope, {
        lines: ticket.lines.map((line) => ({ ...line, name: line.name ?? "" })),
        currencyCode: input.currencyCode,
        currencies,
        deliveryFeeMinor: 0,
        order: {
          customerId,
          userId: null,
          customerName: input.customer.name,
          customerPhone: input.customer.phone ?? "",
          customerEmail: null,
          customerNote: input.note,
          fulfillmentType: "pickup",
          idempotencyKey: input.idempotencyKey,
          channel: "pos",
          createdByUserId: seller.userId,
          registerSessionId,
        },
        status: "completed",
        history: { actor: "merchant", actorUserId: seller.userId },
      });

      if (input.payments.length > 0) {
        const paidAt = new Date();
        await tx.insert(orderPayment).values(
          input.payments.map((payment) => ({
            tenantId: scope.tenantId,
            orderId: created.id,
            kind: "payment",
            method: payment.method,
            amountMinor: payment.amountMinor,
            reference: payment.reference,
            paidAt,
            recordedByUserId: seller.userId,
            registerSessionId,
          })),
        );
        await tx
          .update(order)
          .set({ paymentStatus: paymentStatusOf(created.totalMinor, input.payments.map((p) => ({ kind: "payment", amountMinor: p.amountMinor }))) })
          .where(and(eq(order.tenantId, scope.tenantId), eq(order.storeId, scope.storeId), eq(order.id, created.id)));
      }
      return { ok: true, orderId: created.id } as const;
    });
  } catch (error) {
    if (error instanceof OrderLinesChanged) return { ok: false, error: "ticketChanged" };
    throw error;
  }
}

async function saleByIdempotencyKey(scope: Scope, key: string) {
  const [row] = await db
    .select({ id: order.id })
    .from(order)
    .where(and(eq(order.tenantId, scope.tenantId), eq(order.storeId, scope.storeId), eq(order.idempotencyKey, key)))
    .limit(1);
  return row?.id ?? null;
}

/** The store's contact details printed at the top of a receipt. */
export async function receiptStore(scope: Scope) {
  const [row] = await db
    .select({ name: store.name, address: store.address, phone: store.phone })
    .from(store)
    .where(and(eq(store.id, scope.storeId), eq(store.tenantId, scope.tenantId)));
  return row ?? null;
}
