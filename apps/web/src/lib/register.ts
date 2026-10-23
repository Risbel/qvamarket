import type {
  REGISTER_MOVEMENT_KINDS as DB_REGISTER_MOVEMENT_KINDS,
  REGISTER_SESSION_STATUSES as DB_REGISTER_SESSION_STATUSES,
} from "@qvashop/db/schema";
import { PAYMENT_METHODS, type PaymentMethod } from "@/lib/orders";

// Cash register (day close) of a store: pure and client-safe. The server
// (src/server/register.ts) groups the session's rows in SQL and this adds them up; the same
// function gives the live view of an open session and the frozen report of a closed one.
//
// A session covers [opened_at, closed_at): what was PAID in that time counts (payments and
// refunds by `paid_at`, expenses by `paid_at`), whoever recorded it. Only cash is counted:
// expected = opening float + cash payments - cash refunds + cash in - cash out - cash expenses,
// per currency (never added across currencies). Transfers and "other" are listed, not counted.

export const REGISTER_SESSION_STATUSES = ["open", "closed"] as const satisfies typeof DB_REGISTER_SESSION_STATUSES;
export const REGISTER_MOVEMENT_KINDS = ["in", "out"] as const satisfies typeof DB_REGISTER_MOVEMENT_KINDS;
export type RegisterMovementKind = (typeof REGISTER_MOVEMENT_KINDS)[number];

export const REGISTER_NOTE_MAX = 300;

/** Payments of the session, summed by currency, method and kind (a row of the SQL group by). */
export type RegisterPaymentRow = { currency: string; method: string; kind: string; amountMinor: number; count: number };
/** Expenses paid in the session, by currency and method. */
export type RegisterExpenseRow = { currency: string; method: string; amountMinor: number; count: number };
/** Cash in / out of the session, by currency and kind. */
export type RegisterMovementRow = { currency: string; kind: string; amountMinor: number };
/** Orders created in the session and not cancelled, by currency. */
export type RegisterSalesRow = { currency: string; orders: number; totalMinor: number };

type MethodMoney = { paymentsMinor: number; refundsMinor: number };

export type DrawerCurrency = {
  currency: string;
  openingMinor: number;
  cashPaymentsMinor: number;
  cashRefundsMinor: number;
  cashInMinor: number;
  cashOutMinor: number;
  cashExpensesMinor: number;
  /** what the drawer should hold */
  expectedMinor: number;
  /** payments and refunds by method (cash included), for the report */
  byMethod: Record<PaymentMethod, MethodMoney>;
  /** expenses paid with something other than cash (listed, not counted) */
  otherExpensesMinor: number;
  payments: number;
  expenses: number;
  /** orders created in the session (not cancelled) */
  orders: number;
  salesMinor: number;
};

const zeroMethods = (): Record<PaymentMethod, MethodMoney> =>
  Object.fromEntries(PAYMENT_METHODS.map((m) => [m, { paymentsMinor: 0, refundsMinor: 0 }])) as Record<PaymentMethod, MethodMoney>;
const isMethod = (value: string): value is PaymentMethod => (PAYMENT_METHODS as readonly string[]).includes(value);

/**
 * The drawer of each currency: the session's currencies (with their floats) first, then any
 * other currency that had cash or sales in the session.
 */
export function drawerTotals({
  openings,
  payments,
  expenses,
  movements,
  sales,
}: {
  openings: { currency: string; openingMinor: number }[];
  payments: RegisterPaymentRow[];
  expenses: RegisterExpenseRow[];
  movements: RegisterMovementRow[];
  sales: RegisterSalesRow[];
}): DrawerCurrency[] {
  const order = openings.map((o) => o.currency);
  for (const row of [...payments, ...expenses, ...movements, ...sales]) if (!order.includes(row.currency)) order.push(row.currency);
  const drawers = new Map<string, DrawerCurrency>(
    order.map((currency) => [
      currency,
      {
        currency,
        openingMinor: openings.find((o) => o.currency === currency)?.openingMinor ?? 0,
        cashPaymentsMinor: 0,
        cashRefundsMinor: 0,
        cashInMinor: 0,
        cashOutMinor: 0,
        cashExpensesMinor: 0,
        expectedMinor: 0,
        byMethod: zeroMethods(),
        otherExpensesMinor: 0,
        payments: 0,
        expenses: 0,
        orders: 0,
        salesMinor: 0,
      },
    ]),
  );

  for (const row of payments) {
    const drawer = drawers.get(row.currency)!;
    if (!isMethod(row.method)) continue;
    const refund = row.kind === "refund";
    drawer.byMethod[row.method][refund ? "refundsMinor" : "paymentsMinor"] += row.amountMinor;
    drawer.payments += row.count;
    if (row.method === "cash") drawer[refund ? "cashRefundsMinor" : "cashPaymentsMinor"] += row.amountMinor;
  }
  for (const row of expenses) {
    const drawer = drawers.get(row.currency)!;
    drawer.expenses += row.count;
    if (row.method === "cash") drawer.cashExpensesMinor += row.amountMinor;
    else drawer.otherExpensesMinor += row.amountMinor;
  }
  for (const row of movements) {
    const drawer = drawers.get(row.currency)!;
    if (row.kind === "in") drawer.cashInMinor += row.amountMinor;
    else drawer.cashOutMinor += row.amountMinor;
  }
  for (const row of sales) {
    const drawer = drawers.get(row.currency)!;
    drawer.orders += row.orders;
    drawer.salesMinor += row.totalMinor;
  }
  for (const drawer of drawers.values()) drawer.expectedMinor = expectedCash(drawer);
  return order.map((currency) => drawers.get(currency)!);
}

export function expectedCash(d: Pick<DrawerCurrency, "openingMinor" | "cashPaymentsMinor" | "cashRefundsMinor" | "cashInMinor" | "cashOutMinor" | "cashExpensesMinor">) {
  return d.openingMinor + d.cashPaymentsMinor - d.cashRefundsMinor + d.cashInMinor - d.cashOutMinor - d.cashExpensesMinor;
}

/** The frozen closing report of a session (stored as `register_session.report`). */
export type RegisterReport = {
  version: 1;
  number: number;
  openedAt: string;
  closedAt: string;
  openedBy: string | null;
  closedBy: string | null;
  currencies: (DrawerCurrency & { countedMinor: number; differenceMinor: number })[];
  movements: { kind: RegisterMovementKind; currency: string; amountMinor: number; note: string; at: string; by: string | null }[];
  openingNote: string | null;
  closingNote: string | null;
};

/** Reads a stored report back (null when it is not one: the page then shows the columns only). */
export function parseRegisterReport(value: unknown): RegisterReport | null {
  if (!value || typeof value !== "object") return null;
  const report = value as Partial<RegisterReport>;
  return report.version === 1 && Array.isArray(report.currencies) && Array.isArray(report.movements) ? (report as RegisterReport) : null;
}
