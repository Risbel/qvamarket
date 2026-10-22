import { EXPENSE_CATEGORIES, type ExpenseCategory } from "@/lib/expenses";

// Profit report of a store (P&L), pure and client-safe: the server (src/server/profit.ts)
// sends daily rows grouped in SQL and this adds them up per currency and month.
//
// Months are the STORE's months (store.time_zone), like the income summary. Per month:
//   revenue        = order totals (orders not cancelled, by the day they were placed)
//                  = sales of goods + delivery fees
//   cost of goods  = order_item.unit_cost_minor x quantity (lines with a cost)
//   gross profit   = revenue - cost of goods
//   stock losses   = units removed by hand (damaged, gifts, count corrections, other) at
//                    the cost they had then (only where it was known)
//   expenses       = expense records by the day they were paid
//   net profit     = gross profit - stock losses - expenses
// Units without a cost are counted and reported, never guessed. Currencies are never added
// together: each currency has its own report.

/** Months in the table, the chosen one last. */
export const PROFIT_MONTHS = 12;

/** Reasons whose units left the stock without a sale (only removals, delta < 0, count). */
export const LOSS_REASONS = ["damaged", "gift", "adjustment", "other"] as const;
export type LossReason = (typeof LOSS_REASONS)[number];

/** Orders of one day and currency (not cancelled). */
export type RevenueDayRow = { day: string; currency: string; orders: number; totalMinor: number; deliveryMinor: number };
/** Cost of the goods of those orders: lines with a cost, units without one. */
export type CostDayRow = { day: string; currency: string; costMinor: number; uncostedUnits: number };
export type ExpenseDayRow = { day: string; currency: string; category: string; amountMinor: number };
/** Units removed by hand: at cost (currency = the cost's) or without a cost (currency null). */
export type LossDayRow = { day: string; currency: string | null; reason: string; costMinor: number; units: number };

export type ProfitMonth = {
  /** YYYY-MM */
  month: string;
  orders: number;
  goodsMinor: number;
  deliveryMinor: number;
  revenueMinor: number;
  costOfGoodsMinor: number;
  grossProfitMinor: number;
  lossesMinor: number;
  lossesByReason: Record<LossReason, number>;
  expensesMinor: number;
  expensesByCategory: Record<ExpenseCategory, number>;
  netProfitMinor: number;
  /** units sold without a cost: the real profit is lower than shown */
  uncostedUnits: number;
};

export type CurrencyProfit = { currency: string; months: ProfitMonth[] };

export type ProfitReport = {
  /** the chosen month, YYYY-MM (last of `months`) */
  month: string;
  timeZone: string;
  currencies: CurrencyProfit[];
  /** units removed without a known cost, per month (any currency) */
  uncostedLosses: Record<string, number>;
};

const MONTH = /^(\d{4})-(\d{2})$/;

/** A valid YYYY-MM no later than `latest`, or null. */
export function parseMonth(value: unknown, latest: string): string | null {
  if (typeof value !== "string") return null;
  const match = MONTH.exec(value);
  if (!match || Number(match[1]) < 2000 || Number(match[2]) < 1 || Number(match[2]) > 12) return null;
  return value <= latest ? value : null;
}

/** YYYY-MM plus `months` (negative to go back). */
export function addMonths(month: string, months: number): string {
  const [y, m] = month.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1 + months, 1));
  return date.toISOString().slice(0, 7);
}

/** The PROFIT_MONTHS months ending at `month`, oldest first. */
export function monthsEnding(month: string, count = PROFIT_MONTHS): string[] {
  return Array.from({ length: count }, (_, i) => addMonths(month, i - count + 1));
}

/** Last day (YYYY-MM-DD) of a month. */
export function lastDayOf(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

const zeroBy = <K extends string>(keys: readonly K[]) => Object.fromEntries(keys.map((key) => [key, 0])) as Record<K, number>;

function emptyMonth(month: string): ProfitMonth {
  return {
    month,
    orders: 0,
    goodsMinor: 0,
    deliveryMinor: 0,
    revenueMinor: 0,
    costOfGoodsMinor: 0,
    grossProfitMinor: 0,
    lossesMinor: 0,
    lossesByReason: zeroBy(LOSS_REASONS),
    expensesMinor: 0,
    expensesByCategory: zeroBy(EXPENSE_CATEGORIES),
    netProfitMinor: 0,
    uncostedUnits: 0,
  };
}

/** Profit as a share of revenue, in percent; null without revenue. */
export function margin(profitMinor: number, revenueMinor: number): number | null {
  return revenueMinor > 0 ? (profitMinor / revenueMinor) * 100 : null;
}

/**
 * Adds the daily rows up per currency and month. `currencies` = the store's currencies,
 * default first: always listed, followed by any other currency found in the rows.
 */
export function summarizeProfit({
  month,
  timeZone,
  currencies,
  revenue,
  costs,
  expenses,
  losses,
}: {
  month: string;
  timeZone: string;
  currencies: string[];
  revenue: RevenueDayRow[];
  costs: CostDayRow[];
  expenses: ExpenseDayRow[];
  losses: LossDayRow[];
}): ProfitReport {
  const months = monthsEnding(month);
  const order = [...currencies];
  for (const row of [...revenue, ...costs, ...expenses, ...losses]) {
    if (row.currency !== null && !order.includes(row.currency)) order.push(row.currency);
  }
  const byCurrency = new Map(order.map((currency) => [currency, new Map(months.map((m) => [m, emptyMonth(m)]))]));
  const entry = (currency: string, day: string) => byCurrency.get(currency)?.get(day.slice(0, 7));
  const isLoss = (reason: string): reason is LossReason => (LOSS_REASONS as readonly string[]).includes(reason);
  const isCategory = (category: string): category is ExpenseCategory =>
    (EXPENSE_CATEGORIES as readonly string[]).includes(category);

  for (const row of revenue) {
    const target = entry(row.currency, row.day);
    if (!target) continue;
    target.orders += row.orders;
    target.revenueMinor += row.totalMinor;
    target.deliveryMinor += row.deliveryMinor;
    target.goodsMinor += row.totalMinor - row.deliveryMinor;
  }
  for (const row of costs) {
    const target = entry(row.currency, row.day);
    if (!target) continue;
    target.costOfGoodsMinor += row.costMinor;
    target.uncostedUnits += row.uncostedUnits;
  }
  for (const row of expenses) {
    const target = entry(row.currency, row.day);
    if (!target || !isCategory(row.category)) continue;
    target.expensesMinor += row.amountMinor;
    target.expensesByCategory[row.category] += row.amountMinor;
  }
  const uncostedLosses: Record<string, number> = Object.fromEntries(months.map((m) => [m, 0]));
  for (const row of losses) {
    if (!isLoss(row.reason) || !(row.day.slice(0, 7) in uncostedLosses)) continue;
    if (row.currency === null) {
      uncostedLosses[row.day.slice(0, 7)] += row.units;
      continue;
    }
    const target = entry(row.currency, row.day);
    if (!target) continue;
    target.lossesMinor += row.costMinor;
    target.lossesByReason[row.reason] += row.costMinor;
  }

  for (const monthly of byCurrency.values()) {
    for (const m of monthly.values()) {
      m.grossProfitMinor = m.revenueMinor - m.costOfGoodsMinor;
      m.netProfitMinor = m.grossProfitMinor - m.lossesMinor - m.expensesMinor;
    }
  }

  return {
    month,
    timeZone,
    currencies: order.map((currency) => ({ currency, months: [...byCurrency.get(currency)!.values()] })),
    uncostedLosses,
  };
}
