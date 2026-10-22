import { and, count, db, eq, expense, inArray, inventoryMovement, ne, order, orderItem, sql } from "@qvashop/db";
import { lastDayOf, LOSS_REASONS, monthsEnding, summarizeProfit, type ProfitReport } from "@/lib/profit";
import { localDay, onLocalDays } from "./date-sql";

// Profit report of the merchant's store (P&L). Every query matches tenant_id AND store_id
// (from requireMerchant(), never from client input). Definitions: src/lib/profit.ts.

type Scope = { tenantId: string; storeId: string };

/** bigint sums come back from node-postgres as text */
const sumBig = (expression: ReturnType<typeof sql>) => sql<number>`coalesce(sum(${expression}), 0)::bigint`.mapWith(Number);

/** GROUP BY the first selected column (the day): its timezone is a bound parameter (see income.ts). */
const byFirstColumn = sql`1`;

/** The 12 months ending at `month` (YYYY-MM), counted on the store's days (`timeZone`). */
export async function getProfitReport(scope: Scope, timeZone: string, month: string, currencies: string[]): Promise<ProfitReport> {
  const months = monthsEnding(month);
  const range = { from: `${months[0]}-01`, to: lastDayOf(month), timeZone };
  const inStore = and(eq(order.tenantId, scope.tenantId), eq(order.storeId, scope.storeId));
  const placed = and(inStore, ne(order.status, "cancelled"), onLocalDays(order.createdAt, range));
  const orderDay = localDay(order.createdAt, timeZone);

  const [revenue, costs, expenses, losses] = await Promise.all([
    db
      .select({
        day: orderDay,
        currency: order.currencyCode,
        orders: count(),
        totalMinor: sumBig(sql`${order.totalMinor}`),
        deliveryMinor: sumBig(sql`${order.deliveryFeeMinor}`),
      })
      .from(order)
      .where(placed)
      .groupBy(byFirstColumn, order.currencyCode),
    db
      .select({
        day: orderDay,
        currency: order.currencyCode,
        costMinor: sumBig(sql`${orderItem.unitCostMinor} * ${orderItem.quantity}`),
        uncostedUnits: sql<number>`coalesce(sum(${orderItem.quantity}) filter (where ${orderItem.unitCostMinor} is null), 0)::bigint`.mapWith(Number),
      })
      .from(orderItem)
      .innerJoin(order, and(eq(order.id, orderItem.orderId), eq(order.storeId, orderItem.storeId), eq(order.tenantId, orderItem.tenantId)))
      .where(and(placed, eq(orderItem.tenantId, scope.tenantId)))
      .groupBy(byFirstColumn, order.currencyCode),
    db
      .select({
        day: localDay(expense.paidAt, timeZone),
        currency: expense.currencyCode,
        category: expense.category,
        amountMinor: sumBig(sql`${expense.amountMinor}`),
      })
      .from(expense)
      .where(and(eq(expense.tenantId, scope.tenantId), eq(expense.storeId, scope.storeId), onLocalDays(expense.paidAt, range)))
      .groupBy(byFirstColumn, expense.currencyCode, expense.category),
    // Units that left without a sale; the cost they had then, or none (counted apart)
    db
      .select({
        day: localDay(inventoryMovement.createdAt, timeZone),
        currency: inventoryMovement.costCurrencyCode,
        reason: inventoryMovement.reason,
        costMinor: sumBig(sql`-${inventoryMovement.delta} * coalesce(${inventoryMovement.unitCostMinor}, 0)`),
        units: sumBig(sql`-${inventoryMovement.delta}`),
      })
      .from(inventoryMovement)
      .where(
        and(
          eq(inventoryMovement.tenantId, scope.tenantId),
          eq(inventoryMovement.storeId, scope.storeId),
          inArray(inventoryMovement.reason, [...LOSS_REASONS]),
          sql`${inventoryMovement.delta} < 0`,
          onLocalDays(inventoryMovement.createdAt, range),
        ),
      )
      .groupBy(byFirstColumn, inventoryMovement.costCurrencyCode, inventoryMovement.reason),
  ]);

  return summarizeProfit({ month, timeZone, currencies, revenue, costs, expenses, losses });
}
