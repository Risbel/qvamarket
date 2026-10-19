import { and, count, db, eq, ne, order, orderPayment, sql } from "@qvashop/db";
import { todayIn } from "@/lib/date-range";
import { incomeRange, summarizeIncome, type IncomeSummary } from "@/lib/income";
import { localDay, onLocalDays } from "./date-sql";

// Income summary of the merchant's store (store home). Every query matches tenant_id AND
// store_id (from requireMerchant(), never from client input). Definitions: src/lib/income.ts.

type Scope = { tenantId: string; storeId: string };

/** bigint sums come back from node-postgres as text */
const sumMinor = (column: typeof order.totalMinor | typeof orderPayment.amountMinor) =>
  sql<number>`coalesce(sum(${column}), 0)::bigint`.mapWith(Number);

/**
 * GROUP BY the first selected column (the day). Repeating the day expression does not work: its
 * timezone is a bound parameter, and Postgres sees `... at time zone $1` in the select and
 * `... at time zone $12` in the group by as different expressions.
 */
const byFirstColumn = sql`1`;

/**
 * Sales and collections of this year and of the chart's days, counted on the store's days
 * (`timeZone` = store.time_zone).
 */
export async function getIncomeSummary(scope: Scope, timeZone: string, currencies: string[]): Promise<IncomeSummary> {
  const today = todayIn(timeZone);
  const range = { ...incomeRange(today), timeZone };
  const inStore = and(eq(order.tenantId, scope.tenantId), eq(order.storeId, scope.storeId));

  const paymentDay = localDay(orderPayment.paidAt, timeZone);
  const orderDay = localDay(order.createdAt, timeZone);
  const [payments, sales] = await Promise.all([
    // order_payment has no store_id: the order (same tenant) says which store it belongs to
    db
      .select({
        day: paymentDay,
        currency: order.currencyCode,
        method: orderPayment.method,
        kind: orderPayment.kind,
        amountMinor: sumMinor(orderPayment.amountMinor),
      })
      .from(orderPayment)
      .innerJoin(order, and(eq(order.id, orderPayment.orderId), eq(order.tenantId, orderPayment.tenantId)))
      .where(and(inStore, eq(orderPayment.tenantId, scope.tenantId), onLocalDays(orderPayment.paidAt, range)))
      .groupBy(byFirstColumn, order.currencyCode, orderPayment.method, orderPayment.kind),
    db
      .select({
        day: orderDay,
        currency: order.currencyCode,
        orders: count(),
        totalMinor: sumMinor(order.totalMinor),
      })
      .from(order)
      .where(and(inStore, ne(order.status, "cancelled"), onLocalDays(order.createdAt, range)))
      .groupBy(byFirstColumn, order.currencyCode),
  ]);

  return summarizeIncome({ today, timeZone, currencies, payments, sales });
}
