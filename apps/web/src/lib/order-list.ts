// What the merchant's order list shows, as kept in the URL (shareable, back button works).
// Client-safe: the page parses it, the table builds the next URL with it. Filtering, sorting
// and pagination run in the database (a store can have many orders), not in the browser.

import { parseDateRange, type DateRange } from "@/lib/date-range";
import { ORDER_STATUSES, PAYMENT_STATUSES, type OrderStatus, type PaymentStatus } from "@/lib/orders";

export const ORDER_SORT_COLUMNS = ["date", "customer", "total"] as const;
export type OrderSortColumn = (typeof ORDER_SORT_COLUMNS)[number];
export type OrderSort = { id: OrderSortColumn; desc: boolean };
/** Newest first */
export const DEFAULT_ORDER_SORT: OrderSort = { id: "date", desc: true };

export const ORDER_PAGE_SIZES = [20, 50, 100] as const;
export const DEFAULT_ORDER_PAGE_SIZE = 50;
export const ORDER_QUERY_MAX = 100;
const MAX_PAGE = 10_000;

export type OrderListParams = {
  /** empty = any */
  statuses: OrderStatus[];
  /** empty = any */
  payments: PaymentStatus[];
  /** days in the viewer's timezone; null = any date */
  range: DateRange | null;
  /** order number ("12" or "#12"), or part of the customer's name / phone */
  query: string;
  sort: OrderSort;
  /** 1-based */
  page: number;
  pageSize: number;
};

type SearchParams = Record<string, string | string[] | undefined>;

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";

/** Allowed values of a comma-separated list, in the list's canonical order, without repeats */
function pick<T extends string>(value: string, allowed: readonly T[]): T[] {
  const given = new Set(value.split(","));
  return allowed.filter((item) => given.has(item));
}

/** Anything unexpected in the URL is ignored (falls back to the default). */
export function parseOrderListParams(search: SearchParams): OrderListParams {
  const rawSort = one(search.sort);
  const sortId = rawSort.replace(/^-/, "");
  const size = Number(one(search.size));
  return {
    statuses: pick(one(search.status), ORDER_STATUSES),
    payments: pick(one(search.payment), PAYMENT_STATUSES),
    range: parseDateRange(one(search.from), one(search.to), one(search.tz)),
    query: one(search.q).slice(0, ORDER_QUERY_MAX),
    sort: (ORDER_SORT_COLUMNS as readonly string[]).includes(sortId)
      ? { id: sortId as OrderSortColumn, desc: rawSort.startsWith("-") }
      : DEFAULT_ORDER_SORT,
    page: Math.min(Math.max(Number.parseInt(one(search.page), 10) || 1, 1), MAX_PAGE),
    pageSize: (ORDER_PAGE_SIZES as readonly number[]).includes(size) ? size : DEFAULT_ORDER_PAGE_SIZE,
  };
}

/** The URL query for these params; defaults are left out so links stay short. */
export function orderListQuery(params: OrderListParams): Record<string, string> {
  const query: Record<string, string> = {};
  if (params.statuses.length) query.status = params.statuses.join(",");
  if (params.payments.length) query.payment = params.payments.join(",");
  if (params.range) Object.assign(query, { from: params.range.from, to: params.range.to, tz: params.range.timeZone });
  if (params.query) query.q = params.query;
  const { id, desc } = params.sort;
  if (id !== DEFAULT_ORDER_SORT.id || desc !== DEFAULT_ORDER_SORT.desc) query.sort = `${desc ? "-" : ""}${id}`;
  if (params.page > 1) query.page = String(params.page);
  if (params.pageSize !== DEFAULT_ORDER_PAGE_SIZE) query.size = String(params.pageSize);
  return query;
}

/** True when the list is narrowed by a filter (not by sorting or paging). */
export function hasOrderFilters(params: OrderListParams): boolean {
  return params.statuses.length > 0 || params.payments.length > 0 || params.range !== null || params.query !== "";
}
