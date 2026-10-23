import { cache } from "react";
import {
  and,
  asc,
  count,
  db,
  eq,
  planSetting,
  product,
  store,
  storeBannerImage,
  storeCurrency,
  storePage,
  subscription,
  subscriptionEvent,
} from "@qvashop/db";
import { TRIAL_DAYS, TRIAL_PLAN, addDays, effectiveSubscription, type EffectiveSubscription } from "@/lib/billing";
import { FALLBACK_PLAN, emptyPlanCatalog, isPlanFeature, isPlanKey, planLimit, type PlanCatalog, type PlanFeature, type PlanKey } from "@/lib/plans";
import type { Tx } from "./company-roles";
import { teamSeats } from "./team";

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

/**
 * What each plan includes and whether it is offered (`plan_setting`, edited in /admin/prices).
 * Cached per request. Unknown features are dropped; a plan without a row (the migration seeds
 * all of them) has no features and is offered.
 */
export const getPlanCatalog = cache(async (): Promise<PlanCatalog> => {
  const rows = await db.select().from(planSetting);
  const catalog = emptyPlanCatalog();
  for (const row of rows) {
    if (!isPlanKey(row.planKey)) continue;
    catalog[row.planKey] = { features: row.features.filter(isPlanFeature), offered: row.isOffered };
  }
  return catalog;
});

/** The features of the plan that applies to the company now. Cached per request. */
export const getCompanyFeatures = cache(async (tenantId: string): Promise<readonly PlanFeature[]> => {
  const [{ plan }, catalog] = await Promise.all([getCompanySubscription(tenantId), getPlanCatalog()]);
  return catalog[plan].features;
});

/** The plan of the company that owns `storeId` (storefront reads: prices, banner, badge). Cached per request. */
export const storePlan = cache(async (storeId: string): Promise<PlanKey> => {
  const [row] = await db.select({ tenantId: store.tenantId }).from(store).where(eq(store.id, storeId)).limit(1);
  return row ? (await getCompanySubscription(row.tenantId)).plan : FALLBACK_PLAN;
});

/** The plan features of the company that owns `storeId`. Cached per request. */
export const storeFeatures = cache(async (storeId: string): Promise<readonly PlanFeature[]> => {
  const [plan, catalog] = await Promise.all([storePlan(storeId), getPlanCatalog()]);
  return catalog[plan].features;
});

/**
 * Why an approved store is not public right now, or null: its company's subscription is
 * paused, or the company has more stores than its plan allows (the oldest ones stay public,
 * so a downgrade never takes down the store that has been selling the longest).
 */
export async function storeClosure(store_: { id: string; tenantId: string; createdAt: Date }): Promise<"paused" | "overLimit" | null> {
  const subscription = await getCompanySubscription(store_.tenantId);
  if (subscription.paused) return "paused";
  const max = planLimit(subscription.plan, "stores");
  if (max === null) return null;
  const older = await db
    .select({ id: store.id, createdAt: store.createdAt })
    .from(store)
    .where(and(eq(store.tenantId, store_.tenantId), eq(store.status, "active")))
    .orderBy(asc(store.createdAt), asc(store.id));
  const rank = older.findIndex((s) => s.id === store_.id);
  return rank >= max ? "overLimit" : null;
}

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

export type StoreUsage = {
  storeId: string;
  name: string;
  activeProducts: number;
  currencies: number;
  pages: number;
  /** the larger of the two devices' hero banner image counts */
  bannerImages: number;
};

/** What the company uses of each plan limit (Billing page): company-wide counts and per store. */
export async function getPlanUsage(tenantId: string) {
  const [stores, products, currencies, pages, banners, seats] = await Promise.all([
    db.select({ id: store.id, name: store.name }).from(store).where(eq(store.tenantId, tenantId)).orderBy(asc(store.createdAt)),
    db
      .select({ storeId: product.storeId, total: count() })
      .from(product)
      .where(and(eq(product.tenantId, tenantId), eq(product.status, "active")))
      .groupBy(product.storeId),
    db
      .select({ storeId: storeCurrency.storeId, total: count() })
      .from(storeCurrency)
      .where(eq(storeCurrency.tenantId, tenantId))
      .groupBy(storeCurrency.storeId),
    db.select({ storeId: storePage.storeId, total: count() }).from(storePage).where(eq(storePage.tenantId, tenantId)).groupBy(storePage.storeId),
    db
      .select({ storeId: storeBannerImage.storeId, device: storeBannerImage.device, total: count() })
      .from(storeBannerImage)
      .where(eq(storeBannerImage.tenantId, tenantId))
      .groupBy(storeBannerImage.storeId, storeBannerImage.device),
    teamSeats(db, tenantId, { exceptEmail: null }),
  ]);
  const of = (rows: { storeId: string; total: number }[], id: string) => rows.find((row) => row.storeId === id)?.total ?? 0;
  return {
    stores: stores.length,
    members: seats,
    perStore: stores.map(
      (s): StoreUsage => ({
        storeId: s.id,
        name: s.name,
        activeProducts: of(products, s.id),
        currencies: of(currencies, s.id),
        pages: of(pages, s.id),
        bannerImages: Math.max(0, ...banners.filter((b) => b.storeId === s.id).map((b) => b.total)),
      }),
    ),
  };
}
