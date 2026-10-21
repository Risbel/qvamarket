import type { EXPENSE_CATEGORIES as DB_EXPENSE_CATEGORIES } from "@qvashop/db/schema";
import { parseDateRange, type DateRange } from "@/lib/date-range";

// Expenses of a store (client-safe): categories, and what the list shows as kept in the URL
// (shareable, back button works). Filtering, sorting and pagination run in the database.

/** Client-safe copy of the database list (`satisfies` keeps them identical). */
export const EXPENSE_CATEGORIES = [
  "salaries",
  "rent",
  "utilities",
  "transport",
  "maintenance",
  "marketing",
  "taxes",
  "fees",
  "supplies",
  "other",
] as const satisfies typeof DB_EXPENSE_CATEGORIES;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const EXPENSE_PAYEE_MAX = 120;
export const EXPENSE_NOTE_MAX = 500;

export const EXPENSE_SORT_COLUMNS = ["date", "amount"] as const;
export type ExpenseSortColumn = (typeof EXPENSE_SORT_COLUMNS)[number];
export type ExpenseSort = { id: ExpenseSortColumn; desc: boolean };
/** Most recent first */
export const DEFAULT_EXPENSE_SORT: ExpenseSort = { id: "date", desc: true };

export const EXPENSE_PAGE_SIZES = [20, 50, 100] as const;
export const DEFAULT_EXPENSE_PAGE_SIZE = 50;
export const EXPENSE_QUERY_MAX = 100;
const MAX_PAGE = 10_000;

export type ExpenseListParams = {
  /** empty = any */
  categories: ExpenseCategory[];
  /** days in the viewer's timezone; null = any date */
  range: DateRange | null;
  /** part of the payee or the note */
  query: string;
  sort: ExpenseSort;
  /** 1-based */
  page: number;
  pageSize: number;
};

type SearchParams = Record<string, string | string[] | undefined>;

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";

/** Anything unexpected in the URL is ignored (falls back to the default). */
export function parseExpenseListParams(search: SearchParams): ExpenseListParams {
  const rawSort = one(search.sort);
  const sortId = rawSort.replace(/^-/, "");
  const size = Number(one(search.size));
  const given = new Set(one(search.category).split(","));
  return {
    categories: EXPENSE_CATEGORIES.filter((category) => given.has(category)),
    range: parseDateRange(one(search.from), one(search.to), one(search.tz)),
    query: one(search.q).slice(0, EXPENSE_QUERY_MAX),
    sort: (EXPENSE_SORT_COLUMNS as readonly string[]).includes(sortId)
      ? { id: sortId as ExpenseSortColumn, desc: rawSort.startsWith("-") }
      : DEFAULT_EXPENSE_SORT,
    page: Math.min(Math.max(Number.parseInt(one(search.page), 10) || 1, 1), MAX_PAGE),
    pageSize: (EXPENSE_PAGE_SIZES as readonly number[]).includes(size) ? size : DEFAULT_EXPENSE_PAGE_SIZE,
  };
}

/** The URL query for these params; defaults are left out so links stay short. */
export function expenseListQuery(params: ExpenseListParams): Record<string, string> {
  const query: Record<string, string> = {};
  if (params.categories.length) query.category = params.categories.join(",");
  if (params.range) Object.assign(query, { from: params.range.from, to: params.range.to, tz: params.range.timeZone });
  if (params.query) query.q = params.query;
  const { id, desc } = params.sort;
  if (id !== DEFAULT_EXPENSE_SORT.id || desc !== DEFAULT_EXPENSE_SORT.desc) query.sort = `${desc ? "-" : ""}${id}`;
  if (params.page > 1) query.page = String(params.page);
  if (params.pageSize !== DEFAULT_EXPENSE_PAGE_SIZE) query.size = String(params.pageSize);
  return query;
}

/** True when the list is narrowed by a filter (not by sorting or paging). */
export function hasExpenseFilters(params: ExpenseListParams): boolean {
  return params.categories.length > 0 || params.range !== null || params.query !== "";
}
