import { and, asc, count, countDistinct, customer, db, desc, eq, inArray, ne, or, order, sql } from "@qvashop/db";
import { CUSTOMER_ORDERS_MAX, type CustomerListParams, type CustomerSort } from "@/lib/customer-list";

// Customers of the merchant's store. A `customer` record belongs to the company (shared by its
// stores), so a store's customers are the company's records with at least one order in that
// store, and every figure (orders, amount spent, last order) counts that store's orders only.
// Every query matches tenant_id AND store_id (from requireMerchant(), never from client input).

type Scope = { tenantId: string; storeId: string };

const joinOrders = and(eq(order.customerId, customer.id), eq(order.tenantId, customer.tenantId));
const inStore = ({ tenantId, storeId }: Scope) => and(eq(customer.tenantId, tenantId), eq(order.storeId, storeId));

/** The company's customers with orders in the store (one row each, matching `where`) */
const storeCustomers = (scope: Scope, where?: ReturnType<typeof and>) =>
  db
    .select({
      id: customer.id,
      name: customer.name,
      phone: customer.phone,
      email: customer.email,
      hasAccount: sql<boolean>`${customer.userId} is not null`,
      createdAt: customer.createdAt,
      orders: count(order.id),
      lastOrderAt: sql<Date>`max(${order.createdAt})`.mapWith(order.createdAt),
    })
    .from(customer)
    .innerJoin(order, joinOrders)
    .where(and(inStore(scope), where))
    .groupBy(customer.id);

function searchCondition(query: string) {
  const text = query.trim();
  if (!text) return undefined;
  const like = `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const digits = text.replace(/\D/g, "");
  return or(
    sql`${customer.name} ilike ${like}`,
    sql`${customer.email} ilike ${like}`,
    // phones are stored normalized (digits, optional +): match on the digits typed
    digits.length >= 3 ? sql`${customer.phone} like ${`%${digits}%`}` : undefined,
  );
}

/** What counts as spent: orders not cancelled (edits are reflected in the total) */
const notCancelled = ne(order.status, "cancelled");

function listOrderBy({ id, desc: descending }: CustomerSort, currencyCode: string) {
  const dir = descending ? desc : asc;
  const lastOrder = sql`max(${order.createdAt})`;
  // Ties end with the most recent buyer first, then by id so pages never overlap
  const tail = [desc(lastOrder), asc(customer.id)];
  // ICU collation: accents and case sort as people expect ("Ángel" next to "Andrés")
  if (id === "name") return [dir(sql`${customer.name} collate "und-x-icu"`), ...tail];
  if (id === "orders") return [dir(count(order.id)), ...tail];
  // Only within one currency; customers with nothing spent in it go last either way
  if (id === "spent") {
    const spent = sql`sum(${order.totalMinor}) filter (where ${and(notCancelled, eq(order.currencyCode, currencyCode))})`;
    return [sql`${spent} ${sql.raw(descending ? "desc" : "asc")} nulls last`, ...tail];
  }
  return [dir(lastOrder), asc(customer.id)];
}

/** Amount spent per currency (or only in `currencyCode`) */
async function spentByCustomer({ tenantId, storeId }: Scope, customerIds: string[], currencyCode?: string) {
  const spent = new Map<string, { currencyCode: string; amountMinor: number }[]>();
  if (customerIds.length === 0) return spent;
  const rows = await db
    .select({
      customerId: order.customerId,
      currencyCode: order.currencyCode,
      amountMinor: sql<number>`sum(${order.totalMinor})::bigint`.mapWith(Number),
    })
    .from(order)
    .where(
      and(
        eq(order.tenantId, tenantId),
        eq(order.storeId, storeId),
        inArray(order.customerId, customerIds),
        notCancelled,
        currencyCode ? eq(order.currencyCode, currencyCode) : undefined,
      ),
    )
    .groupBy(order.customerId, order.currencyCode)
    .orderBy(asc(order.currencyCode));
  for (const { customerId, ...amount } of rows) {
    if (customerId) spent.set(customerId, [...(spent.get(customerId) ?? []), amount]);
  }
  return spent;
}

/**
 * A page of the store's customers, with their orders there and what they spent in
 * `currencyCode` (null = nothing; amounts are never added across currencies).
 */
export async function listCustomers(scope: Scope, params: CustomerListParams, currencyCode: string) {
  const search = searchCondition(params.query);
  const [rows, [{ total }]] = await Promise.all([
    storeCustomers(scope, search)
      .orderBy(...listOrderBy(params.sort, currencyCode))
      .limit(params.pageSize)
      .offset((params.page - 1) * params.pageSize),
    db
      .select({ total: countDistinct(customer.id) })
      .from(customer)
      .innerJoin(order, joinOrders)
      .where(and(inStore(scope), search)),
  ]);
  const spent = await spentByCustomer(scope, rows.map((row) => row.id), currencyCode);
  return {
    total,
    customers: rows.map((row) => ({ ...row, spentMinor: spent.get(row.id)?.[0]?.amountMinor ?? null })),
  };
}

/** Currencies of the store's orders (the list can show "spent" in any of them) */
export async function listOrderCurrencies({ tenantId, storeId }: Scope) {
  const rows = await db
    .selectDistinct({ code: order.currencyCode })
    .from(order)
    .where(and(eq(order.tenantId, tenantId), eq(order.storeId, storeId)))
    .orderBy(asc(order.currencyCode));
  return rows.map((row) => row.code);
}

/**
 * One customer with their orders in the store (newest first, at most CUSTOMER_ORDERS_MAX);
 * null when the record is another company's or never ordered in this store.
 */
export async function getCustomer(scope: Scope, id: string) {
  const [row] = await storeCustomers(scope, eq(customer.id, id));
  if (!row) return null;

  const [orders, spent] = await Promise.all([
    db
      .select({
        id: order.id,
        number: order.number,
        createdAt: order.createdAt,
        status: order.status,
        paymentStatus: order.paymentStatus,
        fulfillmentType: order.fulfillmentType,
        currencyCode: order.currencyCode,
        totalMinor: order.totalMinor,
      })
      .from(order)
      .where(and(eq(order.tenantId, scope.tenantId), eq(order.storeId, scope.storeId), eq(order.customerId, row.id)))
      .orderBy(desc(order.createdAt), desc(order.number))
      .limit(CUSTOMER_ORDERS_MAX),
    spentByCustomer(scope, [row.id]),
  ]);
  return { ...row, spent: spent.get(row.id) ?? [], orderList: orders };
}
