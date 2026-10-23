import type {
  BILLING_CYCLES as DB_BILLING_CYCLES,
  BILLING_PAYMENT_METHODS as DB_BILLING_PAYMENT_METHODS,
  INVOICE_KINDS as DB_INVOICE_KINDS,
  INVOICE_STATUSES as DB_INVOICE_STATUSES,
  SUBSCRIPTION_EVENT_TYPES as DB_SUBSCRIPTION_EVENT_TYPES,
  BILLING_REQUEST_KINDS as DB_BILLING_REQUEST_KINDS,
  SUBSCRIPTION_STATUSES as DB_SUBSCRIPTION_STATUSES,
} from "@qvashop/db/schema";
import { FALLBACK_PLAN, isPlanKey, planRank, type PlanKey } from "./plans";

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
  /** trialing: when the trial ends */
  trialEndsAt: Date | null;
};

/**
 * What a subscription gives at `now`. A period that ended unpaid is `past_due` (plan kept)
 * for GRACE_DAYS, then `expired` (free plan). A cancellation or a scheduled downgrade takes
 * effect when the period ends. A pause past its resume date counts as resumed. A trial past its
 * end is the free plan, active.
 */
export function effectiveSubscription(row: SubscriptionRow | null, now: Date = new Date()): EffectiveSubscription {
  const chosenPlan = row && isPlanKey(row.planKey) ? row.planKey : FALLBACK_PLAN;
  const result = (plan: PlanKey, status: SubscriptionStatus, graceEndsAt: Date | null = null) => ({
    plan,
    chosenPlan,
    status,
    graceEndsAt,
    paused: status === "paused",
    trialEndsAt: status === "trialing" ? (row?.trialEndsAt ?? null) : null,
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
      // a trial that ended leaves the company on the free plan (nothing was owed)
      if (row.trialEndsAt && row.trialEndsAt > now) return result(chosenPlan, "trialing");
      return result(FALLBACK_PLAN, "active");
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

export const INVOICE_KINDS = ["renewal", "upgrade", "manual"] as const satisfies typeof DB_INVOICE_KINDS;
export type InvoiceKind = (typeof INVOICE_KINDS)[number];

export const BILLING_PAYMENT_METHODS = ["cash", "transfer", "zelle", "other"] as const satisfies typeof DB_BILLING_PAYMENT_METHODS;
export type BillingPaymentMethod = (typeof BILLING_PAYMENT_METHODS)[number];

export const SUBSCRIPTION_EVENT_TYPES = [
  "created",
  "trial_started",
  "trial_ended",
  "plan_upgraded",
  "downgrade_scheduled",
  "downgrade_cancelled",
  "plan_downgraded",
  "cycle_changed",
  "paused",
  "resumed",
  "cancel_scheduled",
  "reactivated",
  "cancelled",
  "renewed",
  "invoice_issued",
  "invoice_voided",
  "payment_recorded",
  "refund_recorded",
  "became_past_due",
  "expired",
  "price_changed",
  "plan_updated",
  "period_adjusted",
  "trial_adjusted",
  "change_requested",
  "request_closed",
] as const satisfies typeof DB_SUBSCRIPTION_EVENT_TYPES;

export const BILLING_REQUEST_KINDS = ["plan", "pause", "other"] as const satisfies typeof DB_BILLING_REQUEST_KINDS;
export type BillingRequestKind = (typeof BILLING_REQUEST_KINDS)[number];
export const BILLING_REQUEST_MESSAGE_MAX = 500;

/** The renewal job issues the next period's invoice this many days before paid-until. */
export const RENEWAL_LEAD_DAYS = 5;
/** Owners see a banner when the trial ends within this many days. */
export const TRIAL_WARNING_DAYS = 3;
export type SubscriptionEventType = (typeof SUBSCRIPTION_EVENT_TYPES)[number];

/** Days a new invoice gives to pay it (the plan works meanwhile). */
export const DEFAULT_DUE_DAYS = 3;
export const MAX_DUE_DAYS = 60;
/** Longest pause, in days. */
export const MAX_PAUSE_DAYS = 90;

/** Money of an invoice: net = payments - refunds, due = what is still owed (never below 0). */
export function invoiceTotals(amountMinor: number, payments: { kind: string; amountMinor: number }[]) {
  const paid = payments.filter((p) => p.kind !== "refund").reduce((sum, p) => sum + p.amountMinor, 0);
  const refunded = payments.filter((p) => p.kind === "refund").reduce((sum, p) => sum + p.amountMinor, 0);
  const net = paid - refunded;
  return { paid, refunded, net, due: Math.max(0, amountMinor - net) };
}

/** An invoice's status from its payments (net = payments - refunds); `void` is set by hand. */
export function invoiceStatusOf(amountMinor: number, payments: { kind: string; amountMinor: number }[]): InvoiceStatus {
  const { net } = invoiceTotals(amountMinor, payments);
  if (net >= amountMinor) return "paid";
  return net > 0 ? "partial" : "open";
}

/**
 * What an upgrade in the middle of a paid period costs: the price difference for the part of
 * the period that is left, rounded to the minor unit (0 when nothing is left or the new plan
 * is not dearer).
 */
export function prorate(
  oldAmountMinor: number,
  newAmountMinor: number,
  period: { start: Date; end: Date },
  now: Date = new Date(),
): number {
  const total = period.end.getTime() - period.start.getTime();
  const left = period.end.getTime() - Math.max(now.getTime(), period.start.getTime());
  if (total <= 0 || left <= 0 || newAmountMinor <= oldAmountMinor) return 0;
  return Math.round(((newAmountMinor - oldAmountMinor) * left) / total);
}

/** An unpaid invoice past its due date (shown as overdue; not a stored status). */
export function isOverdue(invoice: { status: string; dueAt: Date }, now: Date = new Date()): boolean {
  return (invoice.status === "open" || invoice.status === "partial") && invoice.dueAt <= now;
}

/**
 * What changing to `target` does (the dialog shows it, `changePlan` applies it):
 * - `freeNow` / `freeAtPeriodEnd`: to the free plan, now or when the paid time ends;
 * - `prorated`: up to a dearer plan during a paid period with the same cycle and currency, at
 *   once, paying the difference for the days left;
 * - `atPeriodEnd`: a downgrade (or another cycle / currency) scheduled for the end of the period;
 * - `newPeriod`: a new period starts, with an invoice for its full price;
 * - `noChange`: the same plan and terms during a paid period.
 */
export type PlanChangeOutcome = "freeNow" | "freeAtPeriodEnd" | "prorated" | "atPeriodEnd" | "newPeriod" | "noChange";

export function planChangeOutcome(
  current: { plan: PlanKey; chosenPlan: PlanKey; status: SubscriptionStatus; cycle: string; currencyCode: string; paidUntil: Date | null },
  target: { planKey: PlanKey; cycle: string; currencyCode: string; timing: "now" | "periodEnd" },
  now: Date = new Date(),
): PlanChangeOutcome {
  const paidPeriod =
    current.paidUntil !== null && current.paidUntil > now && (current.status === "active" || current.status === "past_due");
  if (target.planKey === FALLBACK_PLAN) {
    if (current.plan === FALLBACK_PLAN && current.chosenPlan === FALLBACK_PLAN) return "noChange";
    return target.timing === "periodEnd" && paidPeriod ? "freeAtPeriodEnd" : "freeNow";
  }
  const up = planRank(target.planKey) > planRank(current.plan);
  const down = planRank(target.planKey) < planRank(current.plan);
  const sameTerms = target.cycle === current.cycle && target.currencyCode === current.currencyCode;
  if (up && paidPeriod && sameTerms && current.chosenPlan === current.plan) return "prorated";
  if (!up && !down && sameTerms && paidPeriod && current.chosenPlan === target.planKey) return "noChange";
  if ((down || (!up && !sameTerms)) && paidPeriod && target.timing === "periodEnd") return "atPeriodEnd";
  return "newPeriod";
}

/** Badge style of each subscription status (attention for what needs action). */
export const STATUS_BADGE: Record<SubscriptionStatus, "default" | "secondary" | "outline" | "destructive"> = {
  trialing: "outline",
  active: "default",
  past_due: "destructive",
  paused: "secondary",
  cancelled: "secondary",
  expired: "secondary",
};

export const INVOICE_BADGE: Record<InvoiceStatus | "overdue", "default" | "secondary" | "outline" | "destructive"> = {
  open: "outline",
  partial: "outline",
  paid: "default",
  void: "secondary",
  overdue: "destructive",
};

/** Invoice number as shown: QS-000123. */
export function formatInvoiceNumber(number: number): string {
  return `QS-${String(number).padStart(6, "0")}`;
}

/**
 * What the owners' banner says, if anything: payment overdue (until `date`, then free),
 * paused, or a trial ending within TRIAL_WARNING_DAYS (on `date`).
 */
export function billingNotice(
  subscription: EffectiveSubscription,
  now: Date = new Date(),
): { kind: "pastDue" | "paused" | "trialEnding"; date: Date | null } | null {
  if (subscription.status === "past_due") return { kind: "pastDue", date: subscription.graceEndsAt };
  if (subscription.status === "paused") return { kind: "paused", date: null };
  const end = subscription.trialEndsAt;
  if (subscription.status === "trialing" && end && end.getTime() - now.getTime() <= TRIAL_WARNING_DAYS * 86_400_000) {
    return { kind: "trialEnding", date: end };
  }
  return null;
}
