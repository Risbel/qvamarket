import { and, asc, count, db, desc, eq, inArray, or, order, orderItem, orderPayment, orderStatusHistory, sql, user } from "@qvashop/db";
import type { DateRange } from "@/lib/date-range";
import type { OrderStatus } from "@/lib/orders";

// Orders of the merchant's store. Every query matches tenant_id AND store_id (from
// requireMerchant(), never from client input).

type Scope = { tenantId: string; storeId: string };
const inScope = ({ tenantId, storeId }: Scope) => and(eq(order.tenantId, tenantId), eq(order.storeId, storeId));

export const ORDERS_PAGE_SIZE = 50;

export type OrderListFilter = {
  status: OrderStatus | null;
  /** days in the viewer's timezone; null = any date */
  range: DateRange | null;
  /** order number ("12" or "#12"), or part of the customer's name / phone */
  query: string;
  /** 1-based */
  page: number;
};

function searchCondition(query: string) {
  const text = query.trim();
  if (!text) return undefined;
  const number = /^#?\d{1,9}$/.test(text) ? Number(text.replace("#", "")) : null;
  const like = `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const digits = text.replace(/\D/g, "");
  return or(
    number !== null ? eq(order.number, number) : undefined,
    sql`${order.customerName} ilike ${like}`,
    // phones are stored normalized (digits, optional +): match on the digits typed
    digits.length >= 3 ? sql`${order.customerPhone} like ${`%${digits}%`}` : undefined,
  );
}

/**
 * Orders placed on the calendar days `from`..`to` in the range's timezone. The exact test is
 * the order's LOCAL date (instant -> local time always has one answer); converting a local
 * midnight to an instant does not, because some zones change clocks at midnight (Cuba's
 * Nov 1 starts with 00:00 twice). The wider instant bounds only let the index prune rows.
 */
function inDateRange(range: DateRange | null) {
  if (!range) return undefined;
  const { from, to, timeZone } = range;
  return and(
    sql`${order.createdAt} >= (${from}::date)::timestamp at time zone ${timeZone} - interval '1 day'`,
    sql`${order.createdAt} < (${to}::date + 1)::timestamp at time zone ${timeZone} + interval '1 day'`,
    sql`(${order.createdAt} at time zone ${timeZone})::date between ${from}::date and ${to}::date`,
  );
}

/** A page of orders, newest first, with the number of units of each. */
export async function listOrders(scope: Scope, filter: OrderListFilter) {
  const where = and(
    inScope(scope),
    filter.status ? eq(order.status, filter.status) : undefined,
    inDateRange(filter.range),
    searchCondition(filter.query),
  );
  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: order.id,
        number: order.number,
        createdAt: order.createdAt,
        customerName: order.customerName,
        customerPhone: order.customerPhone,
        status: order.status,
        paymentStatus: order.paymentStatus,
        fulfillmentType: order.fulfillmentType,
        currencyCode: order.currencyCode,
        totalMinor: order.totalMinor,
      })
      .from(order)
      .where(where)
      .orderBy(desc(order.createdAt), desc(order.number))
      .limit(ORDERS_PAGE_SIZE)
      .offset((filter.page - 1) * ORDERS_PAGE_SIZE),
    db.select({ total: count() }).from(order).where(where),
  ]);

  // Separate grouped query (see the Drizzle gotcha in CLAUDE.md about raw subqueries)
  const units = new Map<string, number>();
  if (rows.length > 0) {
    const sums = await db
      .select({ orderId: orderItem.orderId, units: sql<number>`sum(${orderItem.quantity})::int` })
      .from(orderItem)
      .where(
        and(
          eq(orderItem.tenantId, scope.tenantId),
          eq(orderItem.storeId, scope.storeId),
          inArray(orderItem.orderId, rows.map((row) => row.id)),
        ),
      )
      .groupBy(orderItem.orderId);
    for (const row of sums) units.set(row.orderId, row.units);
  }

  return {
    total,
    orders: rows.map((row) => ({ ...row, units: units.get(row.id) ?? 0 })),
  };
}

/** Number of orders in each status (for the filter chips), within the date range if any. */
export async function countOrdersByStatus(scope: Scope, range: DateRange | null): Promise<Record<string, number>> {
  const rows = await db
    .select({ status: order.status, total: count() })
    .from(order)
    .where(and(inScope(scope), inDateRange(range)))
    .groupBy(order.status);
  return Object.fromEntries(rows.map((row) => [row.status, row.total]));
}

/** One order with its items, status history and payments; null when not this store's. */
export async function getOrder(scope: Scope, id: string) {
  const [row] = await db.select().from(order).where(and(inScope(scope), eq(order.id, id))).limit(1);
  if (!row) return null;

  const [items, history, payments] = await Promise.all([
    db
      .select({
        id: orderItem.id,
        productId: orderItem.productId,
        productName: orderItem.productName,
        variantTitle: orderItem.variantTitle,
        sku: orderItem.sku,
        quantity: orderItem.quantity,
        unitPriceMinor: orderItem.unitPriceMinor,
        compareAtMinor: orderItem.compareAtMinor,
        lineTotalMinor: orderItem.lineTotalMinor,
      })
      .from(orderItem)
      .where(and(eq(orderItem.orderId, row.id), eq(orderItem.tenantId, scope.tenantId)))
      .orderBy(asc(orderItem.position)),
    db
      .select({
        id: orderStatusHistory.id,
        fromStatus: orderStatusHistory.fromStatus,
        toStatus: orderStatusHistory.toStatus,
        actor: orderStatusHistory.actor,
        actorName: user.name,
        note: orderStatusHistory.note,
        createdAt: orderStatusHistory.createdAt,
      })
      .from(orderStatusHistory)
      .leftJoin(user, eq(user.id, orderStatusHistory.actorUserId))
      .where(and(eq(orderStatusHistory.orderId, row.id), eq(orderStatusHistory.tenantId, scope.tenantId)))
      .orderBy(asc(orderStatusHistory.createdAt)),
    db
      .select({
        id: orderPayment.id,
        kind: orderPayment.kind,
        method: orderPayment.method,
        amountMinor: orderPayment.amountMinor,
        paidAt: orderPayment.paidAt,
        recordedByName: user.name,
        note: orderPayment.note,
      })
      .from(orderPayment)
      .leftJoin(user, eq(user.id, orderPayment.recordedByUserId))
      .where(and(eq(orderPayment.orderId, row.id), eq(orderPayment.tenantId, scope.tenantId)))
      .orderBy(asc(orderPayment.paidAt)),
  ]);

  return { ...row, items, history, payments };
}
