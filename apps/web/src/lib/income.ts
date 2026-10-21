import { addDays, startOfMonth, startOfYear } from "@/lib/date-range";
import { PAYMENT_METHODS, type PaymentMethod } from "@/lib/orders";

// Income summary of a store (store home): sales and money collected today, this month and
// this year, per currency, plus a daily series for the chart. Pure and client-safe: the
// server (src/server/income.ts) sends daily rows grouped in SQL and this adds them up.
//
// Days are the STORE's days (store.time_zone), so everyone sees the same "today" and the
// day close can rely on it.
// - Sales = orders CREATED that day and not cancelled (total_minor, edits already applied).
// - Collected = payment records by their paid_at day, refunds subtracted (refunds of
//   cancelled orders count too). Per method the same: payments - refunds of that method.
// - Gross profit = goods sold (line totals, not the delivery fee) minus what they cost the
//   store (order_item.unit_cost_minor x quantity), on the same orders as sales. Only lines
//   with a cost count; units without one are reported (`uncostedUnits`), never guessed.
// Currencies are never added together.

/** Days in the chart (today included). */
export const INCOME_CHART_DAYS = 30;

/** Payments of one day, currency, method and kind, summed (a row of the SQL group by). */
export type PaymentDayRow = { day: string; currency: string; method: string; kind: string; amountMinor: number };
/** Orders of one day and currency (not cancelled). */
export type SalesDayRow = { day: string; currency: string; orders: number; totalMinor: number };
/** Goods of the same orders: line totals and costs of the lines with a cost, units without one. */
export type GoodsDayRow = { day: string; currency: string; costedGoodsMinor: number; costMinor: number; uncostedUnits: number };

export type MethodTotals = Record<PaymentMethod, number>;

export type PeriodIncome = {
  salesMinor: number;
  orders: number;
  /** payments - refunds */
  collectedMinor: number;
  refundsMinor: number;
  /** payments - refunds, per method (can be negative on a day with only refunds) */
  byMethod: MethodTotals;
  /** line totals of the goods sold that have a cost */
  costedGoodsMinor: number;
  /** what those goods cost the store */
  costMinor: number;
  /** units sold without a cost (left out of the gross profit) */
  uncostedUnits: number;
};

/** Gross profit of a period (only goods with a cost) and its margin in percent (null without such goods). */
export function grossProfit(period: Pick<PeriodIncome, "costedGoodsMinor" | "costMinor">) {
  const profitMinor = period.costedGoodsMinor - period.costMinor;
  const marginPercent = period.costedGoodsMinor > 0 ? (profitMinor / period.costedGoodsMinor) * 100 : null;
  return { profitMinor, marginPercent };
}

export type CurrencyIncome = {
  currency: string;
  today: PeriodIncome;
  month: PeriodIncome;
  year: PeriodIncome;
  /** the last INCOME_CHART_DAYS days, oldest first, every day present */
  daily: { day: string; byMethod: MethodTotals }[];
};

export type IncomeSummary = {
  /** the store's today, YYYY-MM-DD */
  today: string;
  timeZone: string;
  currencies: CurrencyIncome[];
};

/** The days the summary needs: from the earlier of Jan 1 and the chart's first day, to today. */
export function incomeRange(today: string): { from: string; to: string } {
  const chartStart = addDays(today, -(INCOME_CHART_DAYS - 1));
  const yearStart = startOfYear(today);
  return { from: chartStart < yearStart ? chartStart : yearStart, to: today };
}

const zeroMethods = (): MethodTotals => ({ cash: 0, transfer: 0, other: 0 });
const emptyPeriod = (): PeriodIncome => ({
  salesMinor: 0,
  orders: 0,
  collectedMinor: 0,
  refundsMinor: 0,
  byMethod: zeroMethods(),
  costedGoodsMinor: 0,
  costMinor: 0,
  uncostedUnits: 0,
});
const isMethod = (value: string): value is PaymentMethod => (PAYMENT_METHODS as readonly string[]).includes(value);

/**
 * Adds the daily rows up per currency. `currencies` = the store's currencies, default first:
 * they are always listed (with zeros), followed by any other currency found in the rows
 * (an old order in a currency the store no longer sells).
 */
export function summarizeIncome({
  today,
  timeZone,
  currencies,
  payments,
  sales,
  goods = [],
}: {
  today: string;
  timeZone: string;
  currencies: string[];
  payments: PaymentDayRow[];
  sales: SalesDayRow[];
  goods?: GoodsDayRow[];
}): IncomeSummary {
  const monthStart = startOfMonth(today);
  const yearStart = startOfYear(today);
  const chartStart = addDays(today, -(INCOME_CHART_DAYS - 1));
  const chartDays = Array.from({ length: INCOME_CHART_DAYS }, (_, i) => addDays(chartStart, i));

  const order = [...currencies];
  for (const row of [...payments, ...sales, ...goods]) if (!order.includes(row.currency)) order.push(row.currency);

  const byCurrency = new Map<string, CurrencyIncome>(
    order.map((currency) => [
      currency,
      {
        currency,
        today: emptyPeriod(),
        month: emptyPeriod(),
        year: emptyPeriod(),
        daily: chartDays.map((day) => ({ day, byMethod: zeroMethods() })),
      },
    ]),
  );

  // The periods a day belongs to (rows outside the year still feed the chart)
  const periodsOf = (entry: CurrencyIncome, day: string) =>
    [day === today && entry.today, day >= monthStart && entry.month, day >= yearStart && entry.year].filter(
      (period): period is PeriodIncome => Boolean(period),
    );

  for (const row of payments) {
    const entry = byCurrency.get(row.currency)!;
    if (row.day > today || !isMethod(row.method)) continue;
    const signed = row.kind === "refund" ? -row.amountMinor : row.amountMinor;
    for (const period of periodsOf(entry, row.day)) {
      period.collectedMinor += signed;
      period.byMethod[row.method] += signed;
      if (row.kind === "refund") period.refundsMinor += row.amountMinor;
    }
    const point = row.day >= chartStart ? entry.daily[chartDays.indexOf(row.day)] : undefined;
    if (point) point.byMethod[row.method] += signed;
  }

  for (const row of sales) {
    const entry = byCurrency.get(row.currency)!;
    if (row.day > today) continue;
    for (const period of periodsOf(entry, row.day)) {
      period.salesMinor += row.totalMinor;
      period.orders += row.orders;
    }
  }

  for (const row of goods) {
    const entry = byCurrency.get(row.currency)!;
    if (row.day > today) continue;
    for (const period of periodsOf(entry, row.day)) {
      period.costedGoodsMinor += row.costedGoodsMinor;
      period.costMinor += row.costMinor;
      period.uncostedUnits += row.uncostedUnits;
    }
  }

  return { today, timeZone, currencies: order.map((currency) => byCurrency.get(currency)!) };
}
