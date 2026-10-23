import {
  and,
  asc,
  billingRequest,
  db,
  desc,
  eq,
  inArray,
  or,
  organization,
  planPrice,
  planSetting,
  subscription,
  subscriptionEvent,
  subscriptionInvoice,
  subscriptionPayment,
  user,
} from "@qvashop/db";
import {
  DEFAULT_DUE_DAYS,
  GRACE_DAYS,
  RENEWAL_LEAD_DAYS,
  addCycle,
  addDays,
  effectiveSubscription,
  invoiceStatusOf,
  invoiceTotals,
  planChangeOutcome,
  prorate,
  type BillingCycle,
  type BillingPaymentMethod,
  type BillingRequestKind,
  type PlanChangeOutcome,
  type SubscriptionEventType,
} from "@/lib/billing";
import { FALLBACK_PLAN, isPlanKey, planRank, type PlanFeature, type PlanKey } from "@/lib/plans";
import type { Tx } from "./company-roles";

// Manual, recurring billing of the companies (superadmin; the renewal job in step 3 reuses
// these). Every operation runs in one transaction that locks the company's subscription row
// and writes a subscription_event, so the history is complete and two admins cannot
// interleave. `current_period_end` is the PAID-UNTIL date: a new period's invoice leaves it
// at the invoice's due date (the plan works while it can be paid) and paying it moves it to
// the end of the invoiced period. Invoices and payments are never deleted (void / refund).

export type BillingActor = { kind: "admin" | "owner" | "system"; userId: string | null };

type SubscriptionRow = typeof subscription.$inferSelect;

/** The subscription fields kept in an event's before / after. */
function snapshot(row: SubscriptionRow) {
  const iso = (date: Date | null) => date?.toISOString() ?? null;
  return {
    planKey: row.planKey,
    status: row.status,
    cycle: row.cycle,
    currencyCode: row.currencyCode,
    currentPeriodStart: iso(row.currentPeriodStart),
    currentPeriodEnd: iso(row.currentPeriodEnd),
    trialEndsAt: iso(row.trialEndsAt),
    pausedAt: iso(row.pausedAt),
    pauseResumesAt: iso(row.pauseResumesAt),
    cancelAtPeriodEnd: row.cancelAtPeriodEnd,
    scheduledPlanKey: row.scheduledPlanKey,
    scheduledCycle: row.scheduledCycle,
  };
}

/** Only the fields that changed (both sides), so the log reads "plan: pro -> basic". */
function diff(before: SubscriptionRow, after: SubscriptionRow) {
  const a = snapshot(before);
  const b = snapshot(after);
  const keys = (Object.keys(a) as (keyof typeof a)[]).filter((key) => a[key] !== b[key]);
  return {
    before: Object.fromEntries(keys.map((key) => [key, a[key]])),
    after: Object.fromEntries(keys.map((key) => [key, b[key]])),
  };
}

async function logEvent(
  tx: Tx,
  tenantId: string | null,
  type: SubscriptionEventType,
  actor: BillingActor,
  extra: { before?: unknown; after?: unknown; invoiceId?: string; paymentId?: string; note?: string | null } = {},
) {
  await tx.insert(subscriptionEvent).values({
    tenantId,
    type,
    actor: actor.kind,
    actorUserId: actor.userId,
    invoiceId: extra.invoiceId ?? null,
    paymentId: extra.paymentId ?? null,
    before: extra.before ?? null,
    after: extra.after ?? null,
    note: extra.note || null,
  });
}

/** Locks and returns the company's subscription (creating a free one if it is missing). */
async function lockSubscription(tx: Tx, tenantId: string): Promise<SubscriptionRow | null> {
  const [company] = await tx.select({ id: organization.id }).from(organization).where(eq(organization.id, tenantId));
  if (!company) return null;
  await tx.insert(subscription).values({ tenantId, planKey: FALLBACK_PLAN, status: "active" }).onConflictDoNothing();
  const [row] = await tx.select().from(subscription).where(eq(subscription.tenantId, tenantId)).for("update");
  return row ?? null;
}

/** Writes the changes and logs them as one event (nothing is logged when nothing changed). */
async function updateSubscription(
  tx: Tx,
  row: SubscriptionRow,
  changes: Partial<typeof subscription.$inferInsert>,
  type: SubscriptionEventType,
  actor: BillingActor,
  extra: { invoiceId?: string; note?: string | null } = {},
) {
  const [updated] = await tx.update(subscription).set(changes).where(eq(subscription.tenantId, row.tenantId)).returning();
  await logEvent(tx, row.tenantId, type, actor, { ...diff(row, updated), ...extra });
  return updated;
}

async function priceOf(tx: Tx | typeof db, plan: PlanKey, cycle: string, currencyCode: string): Promise<number | null> {
  const [row] = await tx
    .select({ amountMinor: planPrice.amountMinor })
    .from(planPrice)
    .where(
      and(
        eq(planPrice.planKey, plan),
        eq(planPrice.cycle, cycle),
        eq(planPrice.currencyCode, currencyCode),
        eq(planPrice.isActive, true),
      ),
    );
  return row?.amountMinor ?? null;
}

async function companyName(tx: Tx, tenantId: string) {
  const [row] = await tx.select({ name: organization.name }).from(organization).where(eq(organization.id, tenantId));
  return row?.name ?? "";
}

type NewInvoice = {
  kind: "renewal" | "upgrade" | "manual";
  planKey: PlanKey | null;
  cycle: BillingCycle | null;
  period: { start: Date; end: Date } | null;
  amountMinor: number;
  currencyCode: string;
  dueAt: Date;
  note?: string | null;
};

/** Inserts an invoice and logs it. A 0 amount is paid at once (and applied). */
async function issueInvoice(tx: Tx, row: SubscriptionRow, invoice: NewInvoice, actor: BillingActor) {
  const free = invoice.amountMinor === 0;
  const [created] = await tx
    .insert(subscriptionInvoice)
    .values({
      tenantId: row.tenantId,
      companyName: await companyName(tx, row.tenantId),
      kind: invoice.kind,
      planKey: invoice.planKey,
      cycle: invoice.cycle,
      periodStart: invoice.period?.start ?? null,
      periodEnd: invoice.period?.end ?? null,
      amountMinor: invoice.amountMinor,
      currencyCode: invoice.currencyCode,
      status: free ? "paid" : "open",
      dueAt: invoice.dueAt,
      paidAt: free ? new Date() : null,
      note: invoice.note || null,
      createdByUserId: actor.userId,
    })
    .returning();
  await logEvent(tx, row.tenantId, "invoice_issued", actor, {
    invoiceId: created.id,
    after: { number: created.number, kind: created.kind, amountMinor: created.amountMinor, currencyCode: created.currencyCode },
  });
  const current = free ? await applyPaidInvoice(tx, row, created, actor) : row;
  return { invoice: created, subscription: current };
}

/**
 * What a fully paid invoice does to the subscription: a renewal (a period of a plan) makes
 * that plan and cycle the current ones and moves paid-until to the end of its period. Upgrades
 * and manual invoices change nothing (the upgrade already applied). A cancelled subscription
 * is left alone (it has to be reactivated with a plan change).
 */
async function applyPaidInvoice(
  tx: Tx,
  row: SubscriptionRow,
  invoice: typeof subscriptionInvoice.$inferSelect,
  actor: BillingActor,
) {
  if (invoice.kind !== "renewal" || !invoice.periodStart || !invoice.periodEnd || !isPlanKey(invoice.planKey)) return row;
  if (row.status === "cancelled") return row;
  // An old invoice of a plan the company has left since (paid late) changes nothing
  if (invoice.planKey !== row.planKey && invoice.planKey !== row.scheduledPlanKey) return row;
  const end = row.currentPeriodEnd && row.currentPeriodEnd > invoice.periodEnd ? row.currentPeriodEnd : invoice.periodEnd;
  const scheduledApplied = row.scheduledPlanKey === invoice.planKey || row.scheduledCycle === invoice.cycle;
  return updateSubscription(
    tx,
    row,
    {
      planKey: invoice.planKey,
      cycle: invoice.cycle ?? row.cycle,
      currencyCode: invoice.currencyCode,
      status: row.status === "paused" ? "paused" : "active",
      currentPeriodStart: invoice.periodStart < end ? invoice.periodStart : row.currentPeriodStart,
      currentPeriodEnd: end,
      trialEndsAt: null,
      ...(scheduledApplied ? { scheduledPlanKey: null, scheduledCycle: null } : {}),
    },
    "renewed",
    actor,
    { invoiceId: invoice.id },
  );
}

// ---------------------------------------------------------------------------------------
// Plan changes
// ---------------------------------------------------------------------------------------

export type ChangePlanInput = {
  planKey: PlanKey;
  cycle: BillingCycle;
  currencyCode: string;
  /** a downgrade during a paid period: at its end, or now (new period, no refund) */
  timing: "now" | "periodEnd";
  /** when a new period starts (null = now) */
  startsAt: Date | null;
  dueDays: number;
  note: string;
  /** owners may only schedule changes for the end of the period: anything else is refused */
  allowedOutcomes?: PlanChangeOutcome[];
};

export type BillingResult =
  | { ok: true }
  | {
      ok: false;
      error:
        | "notFound"
        | "noPrice"
        | "noChange"
        | "notPaused"
        | "alreadyPaused"
        | "notActive"
        | "noPeriod"
        | "voided"
        | "exceedsDue"
        | "exceedsPaid"
        | "hasPayments"
        | "notTrialing"
        | "notAllowed";
    };

/**
 * Moves a company to another plan (or the same plan with another cycle / currency):
 * - to the free plan: now, or at the end of the paid period (`periodEnd`);
 * - up, during a paid period of the same cycle and currency: at once, with an invoice for the
 *   price difference of the days left (`prorate`);
 * - down during a paid period with `periodEnd`: scheduled (applied by the renewal of the next
 *   period, or by the free fallback if nothing is renewed);
 * - otherwise a new period starts (`startsAt`, default now) with an invoice for its price;
 *   the plan works until the invoice's due date, and paying it extends it to the period end.
 */
export async function changePlan(tenantId: string, input: ChangePlanInput, actor: BillingActor): Promise<BillingResult> {
  return db.transaction(async (tx) => {
    const row = await lockSubscription(tx, tenantId);
    if (!row) return { ok: false, error: "notFound" } as const;
    const now = new Date();
    const current = effectiveSubscription(row, now);
    const outcome = planChangeOutcome(
      { ...current, cycle: row.cycle, currencyCode: row.currencyCode, paidUntil: row.currentPeriodEnd },
      input,
      now,
    );
    const note = input.note;
    if (input.allowedOutcomes && !input.allowedOutcomes.includes(outcome)) return { ok: false, error: "notAllowed" } as const;

    switch (outcome) {
      case "noChange":
        return { ok: false, error: "noChange" } as const;
      case "freeAtPeriodEnd":
        await updateSubscription(tx, row, { scheduledPlanKey: FALLBACK_PLAN, scheduledCycle: null, cancelAtPeriodEnd: false }, "downgrade_scheduled", actor, { note });
        return { ok: true } as const;
      case "freeNow":
        await voidUnpaidRenewals(tx, tenantId, actor);
        await updateSubscription(
          tx,
          row,
          {
            planKey: FALLBACK_PLAN,
            status: "active",
            currentPeriodStart: null,
            currentPeriodEnd: null,
            trialEndsAt: null,
            pausedAt: null,
            pauseResumesAt: null,
            cancelAtPeriodEnd: false,
            scheduledPlanKey: null,
            scheduledCycle: null,
          },
          "plan_downgraded",
          actor,
          { note },
        );
        return { ok: true } as const;
    }

    const price = await priceOf(tx, input.planKey, input.cycle, input.currencyCode);
    if (price === null) return { ok: false, error: "noPrice" } as const;
    const dueAt = (from: Date) => addDays(from, input.dueDays);

    if (outcome === "prorated") {
      // Upgrade inside the paid period: pay the difference for the days left
      const periodEnd = row.currentPeriodEnd!;
      const oldPrice = (await priceOf(tx, current.plan, row.cycle, row.currencyCode)) ?? 0;
      const updated = await updateSubscription(
        tx,
        row,
        { planKey: input.planKey, scheduledPlanKey: null, scheduledCycle: null, cancelAtPeriodEnd: false },
        "plan_upgraded",
        actor,
        { note },
      );
      const amount = prorate(oldPrice, price, { start: row.currentPeriodStart ?? now, end: periodEnd }, now);
      if (amount > 0) {
        await issueInvoice(
          tx,
          updated,
          {
            kind: "upgrade",
            planKey: input.planKey,
            cycle: input.cycle,
            period: { start: now, end: periodEnd },
            amountMinor: amount,
            currencyCode: input.currencyCode,
            dueAt: dueAt(now),
            note,
          },
          actor,
        );
      }
      return { ok: true } as const;
    }

    if (outcome === "atPeriodEnd") {
      // Downgrade (or another cycle / currency): the next period's invoice uses the new terms
      await updateSubscription(
        tx,
        row,
        {
          scheduledPlanKey: input.planKey === row.planKey ? null : input.planKey,
          scheduledCycle: input.cycle === row.cycle ? null : input.cycle,
          ...(input.currencyCode !== row.currencyCode ? { currencyCode: input.currencyCode } : {}),
          cancelAtPeriodEnd: false,
        },
        "downgrade_scheduled",
        actor,
        { note },
      );
      return { ok: true } as const;
    }

    // A new period, from `startsAt`: the plan works until its invoice is due (at least a minute
    // after the start, so the period is never empty), and paying it extends it to the period end
    const start = input.startsAt ?? now;
    const period = { start, end: addCycle(start, input.cycle) };
    const due = new Date(Math.max(dueAt(start).getTime(), dueAt(now).getTime(), start.getTime() + 60_000));
    const rank = planRank(input.planKey) - planRank(current.plan);
    const type: SubscriptionEventType = rank > 0 ? "plan_upgraded" : rank < 0 ? "plan_downgraded" : "cycle_changed";
    await voidUnpaidRenewals(tx, tenantId, actor);
    const updated = await updateSubscription(
      tx,
      row,
      {
        planKey: input.planKey,
        cycle: input.cycle,
        currencyCode: input.currencyCode,
        status: "active",
        currentPeriodStart: start,
        // paid-until: the due date, until the invoice is paid
        currentPeriodEnd: due,
        trialEndsAt: null,
        pausedAt: null,
        pauseResumesAt: null,
        cancelAtPeriodEnd: false,
        scheduledPlanKey: null,
        scheduledCycle: null,
      },
      type,
      actor,
      { note },
    );
    await issueInvoice(
      tx,
      updated,
      {
        kind: "renewal",
        planKey: input.planKey,
        cycle: input.cycle,
        period,
        amountMinor: price,
        currencyCode: input.currencyCode,
        dueAt: due,
        note,
      },
      actor,
    );
    return { ok: true } as const;
  });
}

/**
 * When a new period replaces the current terms, renewal invoices nobody paid anything of are
 * voided (they were for the old plan), each logged.
 */
async function voidUnpaidRenewals(tx: Tx, tenantId: string, actor: BillingActor) {
  const open = await tx
    .select({ id: subscriptionInvoice.id, status: subscriptionInvoice.status })
    .from(subscriptionInvoice)
    .where(and(eq(subscriptionInvoice.tenantId, tenantId), eq(subscriptionInvoice.kind, "renewal"), eq(subscriptionInvoice.status, "open")))
    .for("update");
  for (const invoice of open) {
    const [paid] = await tx
      .select({ id: subscriptionPayment.id })
      .from(subscriptionPayment)
      .where(eq(subscriptionPayment.invoiceId, invoice.id))
      .limit(1);
    if (paid) continue;
    await tx
      .update(subscriptionInvoice)
      .set({ status: "void", voidedAt: new Date(), voidReason: "replaced" })
      .where(eq(subscriptionInvoice.id, invoice.id));
    await logEvent(tx, tenantId, "invoice_voided", actor, {
      invoiceId: invoice.id,
      before: { status: invoice.status },
      after: { status: "void" },
      note: "replaced",
    });
  }
}

/** Withdraws a scheduled downgrade or cycle change. */
export async function cancelScheduledChange(tenantId: string, note: string, actor: BillingActor): Promise<BillingResult> {
  return db.transaction(async (tx) => {
    const row = await lockSubscription(tx, tenantId);
    if (!row) return { ok: false, error: "notFound" } as const;
    if (!row.scheduledPlanKey && !row.scheduledCycle) return { ok: false, error: "noChange" } as const;
    await updateSubscription(tx, row, { scheduledPlanKey: null, scheduledCycle: null }, "downgrade_cancelled", actor, { note });
    return { ok: true } as const;
  });
}

/**
 * Issues the invoice of the period that follows paid-until, with the scheduled plan / cycle
 * if a change is waiting (the renewal job does the same a few days before). One per period.
 */
export async function issueNextInvoice(
  tenantId: string,
  actor: BillingActor,
  dueDays = DEFAULT_DUE_DAYS,
): Promise<BillingResult | { ok: false; error: "alreadyIssued" }> {
  return db.transaction(async (tx) => {
    const row = await lockSubscription(tx, tenantId);
    if (!row) return { ok: false, error: "notFound" } as const;
    if (!row.currentPeriodEnd || row.status === "paused" || row.status === "cancelled" || row.cancelAtPeriodEnd) {
      return { ok: false, error: "noPeriod" } as const;
    }
    const plan = isPlanKey(row.scheduledPlanKey) ? row.scheduledPlanKey : isPlanKey(row.planKey) ? row.planKey : FALLBACK_PLAN;
    if (plan === FALLBACK_PLAN) return { ok: false, error: "noPeriod" } as const;
    const cycle = (row.scheduledCycle ?? row.cycle) as BillingCycle;
    const price = await priceOf(tx, plan, cycle, row.currencyCode);
    if (price === null) return { ok: false, error: "noPrice" } as const;
    const start = row.currentPeriodEnd;
    // That period already invoiced, or a period still waiting to be paid (e.g. the first one of
    // a new plan, whose paid-until is only its due date): never two unpaid renewals at once
    const [existing] = await tx
      .select({ id: subscriptionInvoice.id })
      .from(subscriptionInvoice)
      .where(
        and(
          eq(subscriptionInvoice.tenantId, tenantId),
          eq(subscriptionInvoice.kind, "renewal"),
          or(
            and(eq(subscriptionInvoice.periodStart, start), inArray(subscriptionInvoice.status, ["open", "partial", "paid"])),
            inArray(subscriptionInvoice.status, ["open", "partial"]),
          ),
        ),
      );
    if (existing) return { ok: false, error: "alreadyIssued" } as const;
    await issueInvoice(
      tx,
      row,
      {
        kind: "renewal",
        planKey: plan,
        cycle,
        period: { start, end: addCycle(start, cycle) },
        amountMinor: price,
        currencyCode: row.currencyCode,
        // due on the day the paid time ends (the grace period starts then)
        dueAt: start > addDays(new Date(), dueDays) ? start : addDays(new Date(), dueDays),
      },
      actor,
    );
    return { ok: true } as const;
  });
}

/** An invoice billed by hand (not tied to a period). */
export async function issueManualInvoice(
  tenantId: string,
  input: { amountMinor: number; currencyCode: string; dueAt: Date | null; note: string },
  actor: BillingActor,
): Promise<BillingResult> {
  return db.transaction(async (tx) => {
    const row = await lockSubscription(tx, tenantId);
    if (!row) return { ok: false, error: "notFound" } as const;
    await issueInvoice(
      tx,
      row,
      {
        kind: "manual",
        planKey: null,
        cycle: null,
        period: null,
        amountMinor: input.amountMinor,
        currencyCode: input.currencyCode,
        dueAt: input.dueAt ?? addDays(new Date(), DEFAULT_DUE_DAYS),
        note: input.note,
      },
      actor,
    );
    return { ok: true } as const;
  });
}

// ---------------------------------------------------------------------------------------
// Invoices: payments, refunds, void
// ---------------------------------------------------------------------------------------

async function lockInvoice(tx: Tx, invoiceId: string) {
  const [found] = await tx
    .select({ tenantId: subscriptionInvoice.tenantId })
    .from(subscriptionInvoice)
    .where(eq(subscriptionInvoice.id, invoiceId));
  if (!found) return null;
  // subscription first (same order as every other operation), then the invoice
  const row = found.tenantId ? await lockSubscription(tx, found.tenantId) : null;
  const [invoice] = await tx.select().from(subscriptionInvoice).where(eq(subscriptionInvoice.id, invoiceId)).for("update");
  const payments = await tx
    .select({ kind: subscriptionPayment.kind, amountMinor: subscriptionPayment.amountMinor })
    .from(subscriptionPayment)
    .where(eq(subscriptionPayment.invoiceId, invoiceId));
  return { row, invoice, payments };
}

export type BillingPaymentInput = {
  kind: "payment" | "refund";
  method: BillingPaymentMethod;
  amountMinor: number;
  reference: string;
  paidAt: Date | null;
  note: string;
};

/**
 * Records money received (or given back) for an invoice, in its currency. A payment is at most
 * what is still owed, a refund at most what was collected. The invoice status follows, and an
 * invoice that becomes paid is applied (`applyPaidInvoice`). A refund never shortens the
 * period by itself: change the plan or paid-until if it should.
 */
export async function recordBillingPayment(invoiceId: string, input: BillingPaymentInput, actor: BillingActor): Promise<BillingResult> {
  return db.transaction(async (tx) => {
    const locked = await lockInvoice(tx, invoiceId);
    if (!locked) return { ok: false, error: "notFound" } as const;
    const { row, invoice, payments } = locked;
    if (invoice.status === "void") return { ok: false, error: "voided" } as const;
    const totals = invoiceTotals(invoice.amountMinor, payments);
    if (input.kind === "payment" && input.amountMinor > totals.due) return { ok: false, error: "exceedsDue" } as const;
    if (input.kind === "refund" && input.amountMinor > totals.net) return { ok: false, error: "exceedsPaid" } as const;

    const [payment] = await tx
      .insert(subscriptionPayment)
      .values({
        invoiceId,
        tenantId: invoice.tenantId,
        kind: input.kind,
        method: input.method,
        amountMinor: input.amountMinor,
        currencyCode: invoice.currencyCode,
        reference: input.reference || null,
        paidAt: input.paidAt ?? new Date(),
        recordedByUserId: actor.userId,
        note: input.note || null,
      })
      .returning({ id: subscriptionPayment.id });
    const status = invoiceStatusOf(invoice.amountMinor, [...payments, { kind: input.kind, amountMinor: input.amountMinor }]);
    const [updated] = await tx
      .update(subscriptionInvoice)
      .set({ status, paidAt: status === "paid" ? (invoice.paidAt ?? input.paidAt ?? new Date()) : null })
      .where(eq(subscriptionInvoice.id, invoiceId))
      .returning();
    await logEvent(tx, invoice.tenantId, input.kind === "refund" ? "refund_recorded" : "payment_recorded", actor, {
      invoiceId,
      paymentId: payment.id,
      after: { amountMinor: input.amountMinor, currencyCode: invoice.currencyCode, method: input.method, invoiceStatus: status },
      note: input.note,
    });
    if (row && status === "paid" && invoice.status !== "paid") await applyPaidInvoice(tx, row, updated, actor);
    return { ok: true } as const;
  });
}

/** Cancels an invoice that nobody paid (anything collected must be refunded first). */
export async function voidInvoice(invoiceId: string, reason: string, actor: BillingActor): Promise<BillingResult> {
  return db.transaction(async (tx) => {
    const locked = await lockInvoice(tx, invoiceId);
    if (!locked) return { ok: false, error: "notFound" } as const;
    const { invoice, payments } = locked;
    if (invoice.status === "void") return { ok: false, error: "voided" } as const;
    if (invoiceTotals(invoice.amountMinor, payments).net > 0) return { ok: false, error: "hasPayments" } as const;
    await tx
      .update(subscriptionInvoice)
      .set({ status: "void", voidedAt: new Date(), voidReason: reason, paidAt: null })
      .where(eq(subscriptionInvoice.id, invoiceId));
    await logEvent(tx, invoice.tenantId, "invoice_voided", actor, {
      invoiceId,
      before: { status: invoice.status },
      after: { status: "void" },
      note: reason,
    });
    return { ok: true } as const;
  });
}

// ---------------------------------------------------------------------------------------
// Pause, cancel, corrections
// ---------------------------------------------------------------------------------------

/** Pauses the subscription: stores not public, nothing billed. `resumesAt` null = until resumed by hand. */
export async function pauseSubscription(tenantId: string, resumesAt: Date | null, note: string, actor: BillingActor): Promise<BillingResult> {
  return db.transaction(async (tx) => {
    const row = await lockSubscription(tx, tenantId);
    if (!row) return { ok: false, error: "notFound" } as const;
    const current = effectiveSubscription(row);
    if (current.status === "paused") return { ok: false, error: "alreadyPaused" } as const;
    if (current.status === "expired" || current.status === "cancelled") return { ok: false, error: "notActive" } as const;
    await updateSubscription(tx, row, { status: "paused", pausedAt: new Date(), pauseResumesAt: resumesAt }, "paused", actor, { note });
    return { ok: true } as const;
  });
}

/**
 * Ends a pause. The paused days are given back: paid-until (and a trial's end) move forward
 * by the time the pause lasted (up to its planned end, if it had one).
 */
export async function resumeSubscription(tenantId: string, note: string, actor: BillingActor): Promise<BillingResult> {
  return db.transaction(async (tx) => {
    const row = await lockSubscription(tx, tenantId);
    if (!row) return { ok: false, error: "notFound" } as const;
    if (row.status !== "paused" || !row.pausedAt) return { ok: false, error: "notPaused" } as const;
    await resumeLocked(tx, row, note, actor);
    return { ok: true } as const;
  });
}

async function resumeLocked(tx: Tx, row: SubscriptionRow, note: string, actor: BillingActor, now = new Date()) {
  const pausedAt = row.pausedAt ?? now;
  const until = row.pauseResumesAt && row.pauseResumesAt < now ? row.pauseResumesAt : now;
  const paused = Math.max(0, until.getTime() - pausedAt.getTime());
  const shift = (date: Date | null) => (date && date > pausedAt ? new Date(date.getTime() + paused) : date);
  const trialEndsAt = shift(row.trialEndsAt);
  return updateSubscription(
    tx,
    row,
    {
      status: trialEndsAt && trialEndsAt > now ? "trialing" : "active",
      pausedAt: null,
      pauseResumesAt: null,
      currentPeriodEnd: shift(row.currentPeriodEnd),
      trialEndsAt,
    },
    "resumed",
    actor,
    { note },
  );
}

/** Cancels at the end of the paid period (`atPeriodEnd`) or right away (falls to the free plan). */
export async function cancelSubscription(tenantId: string, atPeriodEnd: boolean, note: string, actor: BillingActor): Promise<BillingResult> {
  return db.transaction(async (tx) => {
    const row = await lockSubscription(tx, tenantId);
    if (!row) return { ok: false, error: "notFound" } as const;
    const current = effectiveSubscription(row);
    if (current.plan === FALLBACK_PLAN || current.status === "cancelled") return { ok: false, error: "notActive" } as const;
    if (atPeriodEnd) {
      if (!row.currentPeriodEnd || row.currentPeriodEnd <= new Date()) return { ok: false, error: "noPeriod" } as const;
      await updateSubscription(tx, row, { cancelAtPeriodEnd: true, scheduledPlanKey: null, scheduledCycle: null }, "cancel_scheduled", actor, { note });
    } else {
      await updateSubscription(
        tx,
        row,
        { status: "cancelled", cancelAtPeriodEnd: false, scheduledPlanKey: null, scheduledCycle: null, pausedAt: null, pauseResumesAt: null },
        "cancelled",
        actor,
        { note },
      );
    }
    return { ok: true } as const;
  });
}

/** Withdraws a cancellation scheduled for the end of the period. */
export async function reactivateSubscription(tenantId: string, note: string, actor: BillingActor): Promise<BillingResult> {
  return db.transaction(async (tx) => {
    const row = await lockSubscription(tx, tenantId);
    if (!row) return { ok: false, error: "notFound" } as const;
    if (!row.cancelAtPeriodEnd) return { ok: false, error: "noChange" } as const;
    await updateSubscription(tx, row, { cancelAtPeriodEnd: false }, "reactivated", actor, { note });
    return { ok: true } as const;
  });
}

/** Corrects paid-until by hand (e.g. a payment made before the system, or a goodwill extension). */
export async function setPaidUntil(tenantId: string, date: Date, note: string, actor: BillingActor): Promise<BillingResult> {
  return db.transaction(async (tx) => {
    const row = await lockSubscription(tx, tenantId);
    if (!row) return { ok: false, error: "notFound" } as const;
    if (row.planKey === FALLBACK_PLAN || row.status === "cancelled" || row.status === "trialing") {
      return { ok: false, error: "notActive" } as const;
    }
    const start = row.currentPeriodStart && row.currentPeriodStart < date ? row.currentPeriodStart : new Date(Math.min(Date.now(), date.getTime() - 1));
    await updateSubscription(
      tx,
      row,
      { currentPeriodStart: start, currentPeriodEnd: date, ...(row.status === "expired" || row.status === "past_due" ? { status: "active" } : {}) },
      "period_adjusted",
      actor,
      { note },
    );
    return { ok: true } as const;
  });
}

/** Moves the end of a running trial. */
export async function setTrialEnd(tenantId: string, date: Date, note: string, actor: BillingActor): Promise<BillingResult> {
  return db.transaction(async (tx) => {
    const row = await lockSubscription(tx, tenantId);
    if (!row) return { ok: false, error: "notFound" } as const;
    if (row.status !== "trialing") return { ok: false, error: "notTrialing" } as const;
    await updateSubscription(tx, row, { trialEndsAt: date }, "trial_adjusted", actor, { note });
    return { ok: true } as const;
  });
}

// ---------------------------------------------------------------------------------------
// Prices
// ---------------------------------------------------------------------------------------

/** Sets a plan's price for a cycle and currency (new invoices use it; old ones keep theirs). */
export async function setPlanPrice(
  input: { planKey: PlanKey; cycle: BillingCycle; currencyCode: string; amountMinor: number; isActive: boolean },
  actor: BillingActor,
): Promise<{ ok: true } | { ok: false; error: "unknownCurrency" }> {
  return db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(planPrice)
      .where(and(eq(planPrice.planKey, input.planKey), eq(planPrice.cycle, input.cycle), eq(planPrice.currencyCode, input.currencyCode)))
      .for("update");
    try {
      await tx
        .insert(planPrice)
        .values(input)
        .onConflictDoUpdate({
          target: [planPrice.planKey, planPrice.cycle, planPrice.currencyCode],
          set: { amountMinor: input.amountMinor, isActive: input.isActive },
        });
    } catch (error) {
      // FK to the platform currency list
      if ((error as { cause?: { code?: string } }).cause?.code === "23503") return { ok: false, error: "unknownCurrency" } as const;
      throw error;
    }
    await logEvent(tx, null, "price_changed", actor, {
      before: before ? { amountMinor: before.amountMinor, isActive: before.isActive } : null,
      after: input,
    });
    return { ok: true } as const;
  });
}

/**
 * What a plan includes and whether merchants can choose it. Applies right away to every
 * company on the plan (nothing is deleted: like a downgrade, only using the feature stops).
 */
export async function setPlanSetting(input: { planKey: PlanKey; features: PlanFeature[]; offered: boolean }, actor: BillingActor) {
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(planSetting).where(eq(planSetting.planKey, input.planKey)).for("update");
    await tx
      .insert(planSetting)
      .values({ planKey: input.planKey, features: input.features, isOffered: input.offered })
      .onConflictDoUpdate({ target: planSetting.planKey, set: { features: input.features, isOffered: input.offered } });
    await logEvent(tx, null, "plan_updated", actor, {
      before: before ? { planKey: before.planKey, features: before.features, offered: before.isOffered } : null,
      after: input,
    });
    return { ok: true } as const;
  });
}

// ---------------------------------------------------------------------------------------
// Reads (superadmin)
// ---------------------------------------------------------------------------------------

export async function listPlanPrices() {
  return db
    .select()
    .from(planPrice)
    .orderBy(asc(planPrice.planKey), asc(planPrice.cycle), asc(planPrice.currencyCode));
}

/** Every company with its subscription and what it owes (open invoices), for the overview. */
export async function listCompanySubscriptions() {
  const companies = await db
    .select({ tenantId: organization.id, name: organization.name, createdAt: organization.createdAt, row: subscription })
    .from(organization)
    .leftJoin(subscription, eq(subscription.tenantId, organization.id))
    .orderBy(asc(organization.name));
  const open = await db
    .select({
      tenantId: subscriptionInvoice.tenantId,
      id: subscriptionInvoice.id,
      amountMinor: subscriptionInvoice.amountMinor,
      currencyCode: subscriptionInvoice.currencyCode,
      dueAt: subscriptionInvoice.dueAt,
    })
    .from(subscriptionInvoice)
    .where(inArray(subscriptionInvoice.status, ["open", "partial"]));
  const payments = open.length
    ? await db
        .select({ invoiceId: subscriptionPayment.invoiceId, kind: subscriptionPayment.kind, amountMinor: subscriptionPayment.amountMinor })
        .from(subscriptionPayment)
        .where(inArray(subscriptionPayment.invoiceId, open.map((i) => i.id)))
    : [];
  return companies.map((company) => {
    const mine = open.filter((i) => i.tenantId === company.tenantId);
    const owed = new Map<string, number>();
    for (const invoice of mine) {
      const { due } = invoiceTotals(invoice.amountMinor, payments.filter((p) => p.invoiceId === invoice.id));
      owed.set(invoice.currencyCode, (owed.get(invoice.currencyCode) ?? 0) + due);
    }
    return {
      tenantId: company.tenantId,
      name: company.name,
      row: company.row,
      effective: effectiveSubscription(company.row),
      owed: [...owed].map(([currencyCode, amountMinor]) => ({ currencyCode, amountMinor })),
      oldestDueAt: mine.reduce<Date | null>((min, i) => (!min || i.dueAt < min ? i.dueAt : min), null),
    };
  });
}

/** One company's billing: subscription, invoices with their payments, and the event log. */
export async function getCompanyBilling(tenantId: string) {
  const [company] = await db
    .select({ tenantId: organization.id, name: organization.name, row: subscription })
    .from(organization)
    .leftJoin(subscription, eq(subscription.tenantId, organization.id))
    .where(eq(organization.id, tenantId));
  if (!company) return null;

  const invoices = await db
    .select()
    .from(subscriptionInvoice)
    .where(eq(subscriptionInvoice.tenantId, tenantId))
    .orderBy(desc(subscriptionInvoice.createdAt));
  const payments = invoices.length
    ? await db
        .select({
          id: subscriptionPayment.id,
          invoiceId: subscriptionPayment.invoiceId,
          kind: subscriptionPayment.kind,
          method: subscriptionPayment.method,
          amountMinor: subscriptionPayment.amountMinor,
          reference: subscriptionPayment.reference,
          paidAt: subscriptionPayment.paidAt,
          note: subscriptionPayment.note,
          recordedBy: user.name,
        })
        .from(subscriptionPayment)
        .leftJoin(user, eq(user.id, subscriptionPayment.recordedByUserId))
        .where(inArray(subscriptionPayment.invoiceId, invoices.map((i) => i.id)))
        .orderBy(asc(subscriptionPayment.paidAt))
    : [];
  const events = await db
    .select({
      id: subscriptionEvent.id,
      type: subscriptionEvent.type,
      actor: subscriptionEvent.actor,
      actorName: user.name,
      invoiceNumber: subscriptionInvoice.number,
      before: subscriptionEvent.before,
      after: subscriptionEvent.after,
      note: subscriptionEvent.note,
      createdAt: subscriptionEvent.createdAt,
    })
    .from(subscriptionEvent)
    .leftJoin(user, eq(user.id, subscriptionEvent.actorUserId))
    .leftJoin(subscriptionInvoice, eq(subscriptionInvoice.id, subscriptionEvent.invoiceId))
    .where(eq(subscriptionEvent.tenantId, tenantId))
    .orderBy(desc(subscriptionEvent.createdAt))
    .limit(200);

  return {
    tenantId: company.tenantId,
    name: company.name,
    row: company.row,
    effective: effectiveSubscription(company.row),
    invoices: invoices.map((invoice) => {
      const own = payments.filter((p) => p.invoiceId === invoice.id);
      return { ...invoice, payments: own, totals: invoiceTotals(invoice.amountMinor, own) };
    }),
    events,
  };
}

// ---------------------------------------------------------------------------------------
// Renewal job (POST /api/cron/billing, daily; also "Run now" in the admin)
// ---------------------------------------------------------------------------------------

const SYSTEM: BillingActor = { kind: "system", userId: null };

/**
 * Brings one company's stored subscription in line with the clock (what effectiveSubscription
 * already shows), each move logged as the system: a trial that ended -> free; a pause past
 * its date -> resumed (paused days given back); a period that ended with a cancellation or a
 * downgrade to free scheduled -> that; unpaid -> past_due, then expired after the grace days.
 */
async function maintainSubscription(tenantId: string, now: Date): Promise<SubscriptionEventType[]> {
  return db.transaction(async (tx) => {
    let row = await lockSubscription(tx, tenantId);
    if (!row) return [];
    const done: SubscriptionEventType[] = [];

    if (row.status === "trialing" && row.trialEndsAt && row.trialEndsAt <= now) {
      row = await updateSubscription(tx, row, { planKey: FALLBACK_PLAN, status: "active", trialEndsAt: null }, "trial_ended", SYSTEM);
      done.push("trial_ended");
    }
    if (row.status === "paused" && row.pauseResumesAt && row.pauseResumesAt <= now) {
      row = await resumeLocked(tx, row, "", SYSTEM, now);
      done.push("resumed");
    }
    const end = row.currentPeriodEnd;
    if ((row.status === "active" || row.status === "past_due") && end && end <= now) {
      if (row.cancelAtPeriodEnd) {
        await updateSubscription(tx, row, { status: "cancelled", cancelAtPeriodEnd: false, scheduledPlanKey: null, scheduledCycle: null }, "cancelled", SYSTEM);
        done.push("cancelled");
      } else if (row.scheduledPlanKey === FALLBACK_PLAN || row.planKey === FALLBACK_PLAN) {
        await updateSubscription(
          tx,
          row,
          { planKey: FALLBACK_PLAN, status: "active", currentPeriodStart: null, currentPeriodEnd: null, scheduledPlanKey: null, scheduledCycle: null },
          "plan_downgraded",
          SYSTEM,
        );
        done.push("plan_downgraded");
      } else if (addDays(end, GRACE_DAYS) <= now) {
        await updateSubscription(tx, row, { status: "expired" }, "expired", SYSTEM);
        done.push("expired");
      } else if (row.status === "active") {
        await updateSubscription(tx, row, { status: "past_due" }, "became_past_due", SYSTEM);
        done.push("became_past_due");
      }
    }
    return done;
  });
}

/** Should the job issue the next period's invoice now? (the rest is checked by issueNextInvoice) */
function renewalDue(row: SubscriptionRow, now: Date) {
  if (row.status !== "active" && row.status !== "past_due") return false;
  if (!row.currentPeriodEnd || row.cancelAtPeriodEnd) return false;
  return row.currentPeriodEnd.getTime() - now.getTime() <= RENEWAL_LEAD_DAYS * 86_400_000;
}

export type BillingJobSummary = {
  companies: number;
  events: Partial<Record<SubscriptionEventType, number>>;
  invoices: number;
  failed: number;
};

/**
 * Runs the maintenance and the renewals of every company that may need them. Idempotent (each
 * move checks the stored state under the lock, renewals are one per period), so running it
 * twice, or late, does no harm. One company failing does not stop the others.
 */
export async function runBillingJob(now: Date = new Date()): Promise<BillingJobSummary> {
  const rows = await db
    .select({ tenantId: subscription.tenantId })
    .from(subscription)
    .where(inArray(subscription.status, ["trialing", "active", "past_due", "paused"]));
  const summary: BillingJobSummary = { companies: rows.length, events: {}, invoices: 0, failed: 0 };
  for (const { tenantId } of rows) {
    try {
      for (const type of await maintainSubscription(tenantId, now)) summary.events[type] = (summary.events[type] ?? 0) + 1;
      const [row] = await db.select().from(subscription).where(eq(subscription.tenantId, tenantId));
      if (row && renewalDue(row, now)) {
        const issued = await issueNextInvoice(tenantId, SYSTEM);
        if (issued.ok) summary.invoices += 1;
      }
    } catch (error) {
      summary.failed += 1;
      console.error("billing job failed for company", tenantId, error);
    }
  }
  console.info("billing job", JSON.stringify(summary));
  return summary;
}

// ---------------------------------------------------------------------------------------
// Requests from the company owner (plan change, pause, anything else)
// ---------------------------------------------------------------------------------------

export type BillingRequestInput = {
  kind: BillingRequestKind;
  planKey: PlanKey | null;
  cycle: BillingCycle | null;
  message: string;
};

/** Records (or replaces) the company's open request, logged as the owner. */
export async function createBillingRequest(tenantId: string, input: BillingRequestInput, actor: BillingActor): Promise<BillingResult> {
  return db.transaction(async (tx) => {
    const row = await lockSubscription(tx, tenantId);
    if (!row) return { ok: false, error: "notFound" } as const;
    const values = {
      kind: input.kind,
      planKey: input.kind === "plan" ? input.planKey : null,
      cycle: input.kind === "plan" ? input.cycle : null,
      message: input.message || null,
      createdByUserId: actor.userId,
    };
    const [open] = await tx
      .select({ id: billingRequest.id })
      .from(billingRequest)
      .where(and(eq(billingRequest.tenantId, tenantId), eq(billingRequest.status, "open")))
      .for("update");
    if (open) await tx.update(billingRequest).set({ ...values, createdAt: new Date() }).where(eq(billingRequest.id, open.id));
    else await tx.insert(billingRequest).values({ tenantId, ...values });
    await logEvent(tx, tenantId, "change_requested", actor, {
      after: { kind: values.kind, planKey: values.planKey, cycle: values.cycle },
      note: values.message,
    });
    return { ok: true } as const;
  });
}

/** Closes the company's open request: done / dismissed by the superadmin, or withdrawn by the owner. */
export async function closeBillingRequest(tenantId: string, status: "done" | "dismissed", actor: BillingActor): Promise<BillingResult> {
  return db.transaction(async (tx) => {
    const row = await lockSubscription(tx, tenantId);
    if (!row) return { ok: false, error: "notFound" } as const;
    const closed = await tx
      .update(billingRequest)
      .set({ status, handledByUserId: actor.userId, handledAt: new Date() })
      .where(and(eq(billingRequest.tenantId, tenantId), eq(billingRequest.status, "open")))
      .returning({ id: billingRequest.id, kind: billingRequest.kind });
    if (closed.length === 0) return { ok: false, error: "notFound" } as const;
    await logEvent(tx, tenantId, "request_closed", actor, { after: { kind: closed[0].kind, status } });
    return { ok: true } as const;
  });
}

export async function getOpenBillingRequest(tenantId: string) {
  const [row] = await db
    .select({
      id: billingRequest.id,
      kind: billingRequest.kind,
      planKey: billingRequest.planKey,
      cycle: billingRequest.cycle,
      message: billingRequest.message,
      createdAt: billingRequest.createdAt,
      createdBy: user.name,
    })
    .from(billingRequest)
    .leftJoin(user, eq(user.id, billingRequest.createdByUserId))
    .where(and(eq(billingRequest.tenantId, tenantId), eq(billingRequest.status, "open")));
  return row ?? null;
}

/** Companies with an open request (admin overview). */
export async function listOpenBillingRequests() {
  return db
    .select({ tenantId: billingRequest.tenantId, kind: billingRequest.kind, createdAt: billingRequest.createdAt })
    .from(billingRequest)
    .where(eq(billingRequest.status, "open"));
}
