import type {
  BILLING_CYCLES as DB_BILLING_CYCLES,
  INVOICE_STATUSES as DB_INVOICE_STATUSES,
  SUBSCRIPTION_STATUSES as DB_SUBSCRIPTION_STATUSES,
} from "@qvashop/db/schema";
import { FALLBACK_PLAN, isPlanKey, type PlanKey } from "./plans";

/**
 * Manual, recurring billing (no gateway): pure rules shared by the panel, the superadmin and
 * the renewal job. The plan a company actually gets is always derived from the stored row and
 * the clock (`effectiveSubscription`), so a renewal job that did not run never keeps a paid
 * plan alive past its grace period, nor takes one away early. Client-safe.
 */
export const SUBSCRIPTION_STATUSES = [
  "trialing",
  "active",
  "past_due",
  "paused",
  "cancelled",
  "expired",
] as const satisfies typeof DB_SUBSCRIPTION_STATUSES;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const BILLING_CYCLES = ["monthly", "quarterly", "yearly"] as const satisfies typeof DB_BILLING_CYCLES;
export type BillingCycle = (typeof BILLING_CYCLES)[number];

export const INVOICE_STATUSES = ["open", "partial", "paid", "void"] as const satisfies typeof DB_INVOICE_STATUSES;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

/** Days a paid plan keeps working after its period ended unpaid (status past_due). */
export const GRACE_DAYS = 7;
/** Length of the free trial of new companies, and the plan it gives. */
export const TRIAL_DAYS = 14;
export const TRIAL_PLAN: PlanKey = "pro";

const DAY_MS = 86_400_000;

export const addDays = (date: Date, days: number) => new Date(date.getTime() + days * DAY_MS);

/** The same instant one cycle later (calendar months, clamped to the month's last day). */
export function addCycle(date: Date, cycle: BillingCycle): Date {
  const months = cycle === "monthly" ? 1 : cycle === "quarterly" ? 3 : 12;
  const next = new Date(date);
  const day = next.getUTCDate();
  next.setUTCDate(1);
  next.setUTCMonth(next.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
  next.setUTCDate(Math.min(day, lastDay));
  return next;
}

export type SubscriptionRow = {
  planKey: string;
  status: string;
  currentPeriodEnd: Date | null;
  trialEndsAt: Date | null;
  pauseResumesAt: Date | null;
  cancelAtPeriodEnd: boolean;
  scheduledPlanKey: string | null;
};

export type EffectiveSubscription = {
  /** the plan whose features and limits apply right now */
  plan: PlanKey;
  /** the plan the company chose (differs from `plan` once it expired or was cancelled) */
  chosenPlan: PlanKey;
  status: SubscriptionStatus;
  /** past_due: when the grace period ends and the company falls to the free plan */
  graceEndsAt: Date | null;
  /** paused: the stores are not public and nothing is billed */
  paused: boolean;
};

/**
 * What a subscription gives at `now`. A period that ended unpaid is `past_due` (plan kept)
 * for GRACE_DAYS, then `expired` (free plan). A cancellation or a scheduled downgrade takes
 * effect when the period ends. A pause past its resume date counts as resumed.
 */
export function effectiveSubscription(row: SubscriptionRow | null, now: Date = new Date()): EffectiveSubscription {
  const chosenPlan = row && isPlanKey(row.planKey) ? row.planKey : FALLBACK_PLAN;
  const result = (plan: PlanKey, status: SubscriptionStatus, graceEndsAt: Date | null = null) => ({
    plan,
    chosenPlan,
    status,
    graceEndsAt,
    paused: status === "paused",
  });
  if (!row) return result(FALLBACK_PLAN, "active");

  switch (row.status) {
    case "cancelled":
    case "expired":
      return result(FALLBACK_PLAN, row.status);
    case "paused":
      if (row.pauseResumesAt && row.pauseResumesAt <= now) break;
      return result(chosenPlan, "paused");
    case "trialing":
      if (row.trialEndsAt && row.trialEndsAt > now) return result(chosenPlan, "trialing");
      return result(FALLBACK_PLAN, "expired");
  }

  // active or past_due: the paid period decides
  const end = row.currentPeriodEnd;
  if (!end || end > now) return result(chosenPlan, "active");
  if (row.cancelAtPeriodEnd) return result(FALLBACK_PLAN, "cancelled");
  const next = isPlanKey(row.scheduledPlanKey) ? row.scheduledPlanKey : chosenPlan;
  if (next === FALLBACK_PLAN) return result(FALLBACK_PLAN, "active");
  const graceEndsAt = addDays(end, GRACE_DAYS);
  if (graceEndsAt > now) return result(next, "past_due", graceEndsAt);
  return result(FALLBACK_PLAN, "expired");
}

/** An invoice's status from its payments (net = payments - refunds); `void` is set by hand. */
export function invoiceStatusOf(amountMinor: number, payments: { kind: string; amountMinor: number }[]): InvoiceStatus {
  const net = payments.reduce((sum, p) => sum + (p.kind === "refund" ? -p.amountMinor : p.amountMinor), 0);
  if (net >= amountMinor) return "paid";
  return net > 0 ? "partial" : "open";
}

/** An unpaid invoice past its due date (shown as overdue; not a stored status). */
export function isOverdue(invoice: { status: string; dueAt: Date }, now: Date = new Date()): boolean {
  return (invoice.status === "open" || invoice.status === "partial") && invoice.dueAt <= now;
}

/** Invoice number as shown: QS-000123. */
export function formatInvoiceNumber(number: number): string {
  return `QS-${String(number).padStart(6, "0")}`;
}
