import { cache } from "react";
import { db, eq, subscription, subscriptionEvent } from "@qvashop/db";
import { TRIAL_DAYS, TRIAL_PLAN, addDays, effectiveSubscription, type EffectiveSubscription } from "@/lib/billing";
import type { Tx } from "./company-roles";

/**
 * The company's subscription as it applies right now (plan, status). Cached per request.
 * A company without a row (should not happen: every company gets one when created) is on
 * the free plan.
 */
export const getCompanySubscription = cache(async (tenantId: string): Promise<EffectiveSubscription> => {
  const [row] = await db
    .select({
      planKey: subscription.planKey,
      status: subscription.status,
      currentPeriodEnd: subscription.currentPeriodEnd,
      trialEndsAt: subscription.trialEndsAt,
      pauseResumesAt: subscription.pauseResumesAt,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      scheduledPlanKey: subscription.scheduledPlanKey,
    })
    .from(subscription)
    .where(eq(subscription.tenantId, tenantId))
    .limit(1);
  return effectiveSubscription(row ?? null);
});

/** A new company's subscription: a free trial of TRIAL_PLAN, logged. */
export async function createTrialSubscription(executor: typeof db | Tx, tenantId: string) {
  const trialEndsAt = addDays(new Date(), TRIAL_DAYS);
  await executor.insert(subscription).values({ tenantId, planKey: TRIAL_PLAN, status: "trialing", trialEndsAt });
  await executor.insert(subscriptionEvent).values({
    tenantId,
    type: "trial_started",
    actor: "system",
    after: { planKey: TRIAL_PLAN, status: "trialing", trialEndsAt: trialEndsAt.toISOString() },
  });
}
