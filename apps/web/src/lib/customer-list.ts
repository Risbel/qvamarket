// What the merchant's customer list shows, as kept in the URL (shareable, back button works).
// Client-safe: the page parses it, the table builds the next URL with it. Like the order list,
// searching, sorting and pagination run in the database.

export const CUSTOMER_SORT_COLUMNS = ["lastOrder", "name", "orders", "spent"] as const;
export type CustomerSortColumn = (typeof CUSTOMER_SORT_COLUMNS)[number];
export type CustomerSort = { id: CustomerSortColumn; desc: boolean };
/** Most recent buyers first */
export const DEFAULT_CUSTOMER_SORT: CustomerSort = { id: "lastOrder", desc: true };

export const CUSTOMER_PAGE_SIZES = [20, 50, 100] as const;
export const DEFAULT_CUSTOMER_PAGE_SIZE = 50;
export const CUSTOMER_QUERY_MAX = 100;
const MAX_PAGE = 10_000;

export type CustomerListParams = {
  /** part of the name or email, or 3+ digits of the phone */
  query: string;
  /** the currency "spent" is shown and sorted in (amounts never mix currencies); "" = the
   * store's default. The page falls back to "" for a currency the store has no orders or
   * prices in. */
  currency: string;
  sort: CustomerSort;
  /** 1-based */
  page: number;
  pageSize: number;
};

type SearchParams = Record<string, string | string[] | undefined>;

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";

/** Anything unexpected in the URL is ignored (falls back to the default). */
export function parseCustomerListParams(search: SearchParams): CustomerListParams {
  const rawSort = one(search.sort);
  const sortId = rawSort.replace(/^-/, "");
  const size = Number(one(search.size));
  return {
    query: one(search.q).slice(0, CUSTOMER_QUERY_MAX),
    currency: /^[A-Z]{3}$/.test(one(search.currency)) ? one(search.currency) : "",
    sort: (CUSTOMER_SORT_COLUMNS as readonly string[]).includes(sortId)
      ? { id: sortId as CustomerSortColumn, desc: rawSort.startsWith("-") }
      : DEFAULT_CUSTOMER_SORT,
    page: Math.min(Math.max(Number.parseInt(one(search.page), 10) || 1, 1), MAX_PAGE),
    pageSize: (CUSTOMER_PAGE_SIZES as readonly number[]).includes(size) ? size : DEFAULT_CUSTOMER_PAGE_SIZE,
  };
}

/** The URL query for these params; defaults are left out so links stay short. */
export function customerListQuery(params: CustomerListParams): Record<string, string> {
  const query: Record<string, string> = {};
  if (params.query) query.q = params.query;
  if (params.currency) query.currency = params.currency;
  const { id, desc } = params.sort;
  if (id !== DEFAULT_CUSTOMER_SORT.id || desc !== DEFAULT_CUSTOMER_SORT.desc) query.sort = `${desc ? "-" : ""}${id}`;
  if (params.page > 1) query.page = String(params.page);
  if (params.pageSize !== DEFAULT_CUSTOMER_PAGE_SIZE) query.size = String(params.pageSize);
  return query;
}

/** The customer page lists this many of their orders, newest first */
export const CUSTOMER_ORDERS_MAX = 100;
