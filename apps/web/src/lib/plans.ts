import type { PLAN_KEYS as DB_PLAN_KEYS } from "@qvashop/db/schema";
import { RESOURCES, normalizePermissions, type PermissionRequest, type Permissions, type Resource } from "./permissions";

/**
 * Plans: what a company gets for its subscription. Features and limits are defined here, once;
 * prices live in the `plan_price` table. Names and descriptions: `Plans.plans.<key>` messages.
 *
 * A plan is a gate on top of the roles: the role says who may use a section, the plan says
 * whether the company has it. Selling is never limited (no order quotas) and nothing is
 * deleted on a downgrade: data over a limit stays, only creating more is refused.
 *
 * Client-safe and pure.
 */
export const PLAN_KEYS = ["free", "basic", "pro", "business"] as const satisfies typeof DB_PLAN_KEYS;
export type PlanKey = (typeof PLAN_KEYS)[number];

/** Plan features that are not a whole permission resource, plus those that are (see PLAN_GATES). */
export const PLAN_FEATURES = [
  "customers",
  "promotions",
  "inventory",
  "expenses",
  // collected by method, 30-day chart (the basic home only shows sales)
  "advancedReports",
  // base gray, radius, tinted surfaces (logo and colors are on every plan)
  "theme",
  "secondaryBanner",
  "distanceFees",
  // follow the rate / adjust % on many products at once
  "bulkPrices",
  // create and edit roles (other plans use the presets as they are)
  "customRoles",
  // choose which stores each member can open
  "storeAccess",
  // no "Hecho con QvaShop" in the storefront footer
  "hideBadge",
  // the cash register: opening float, cash in / out, cash count and Z report
  "dayClose",
] as const;
export type PlanFeature = (typeof PLAN_FEATURES)[number];

/** Countable things a plan limits. null = no plan limit (the platform's own caps still apply). */
export type PlanLimits = {
  stores: number;
  activeProducts: number | null;
  imagesPerProduct: number;
  currencies: number;
  /** hero banner images per device */
  bannerImages: number;
  pages: number;
  /** team members besides the owner(s) */
  members: number;
};
export type PlanLimit = keyof PlanLimits;

export type Plan = { features: readonly PlanFeature[]; limits: PlanLimits };

export const PLANS = {
  free: {
    features: [],
    limits: { stores: 1, activeProducts: 30, imagesPerProduct: 3, currencies: 1, bannerImages: 1, pages: 1, members: 0 },
  },
  basic: {
    features: ["customers", "hideBadge"],
    limits: { stores: 1, activeProducts: 300, imagesPerProduct: 6, currencies: 2, bannerImages: 3, pages: 5, members: 2 },
  },
  pro: {
    features: [
      "customers",
      "promotions",
      "inventory",
      "expenses",
      "advancedReports",
      "theme",
      "secondaryBanner",
      "distanceFees",
      "bulkPrices",
      "customRoles",
      "hideBadge",
      "dayClose",
    ],
    limits: { stores: 3, activeProducts: 3000, imagesPerProduct: 6, currencies: 5, bannerImages: 5, pages: 20, members: 10 },
  },
  business: {
    features: PLAN_FEATURES,
    limits: { stores: 10, activeProducts: null, imagesPerProduct: 6, currencies: 10, bannerImages: 5, pages: 20, members: 50 },
  },
} as const satisfies Record<PlanKey, Plan>;

/** What a company falls to when a paid plan ends (expired, cancelled, trial over). */
export const FALLBACK_PLAN: PlanKey = "free";

/**
 * Permission resources (or some of their actions) that need a plan feature. A role may grant
 * them, but nobody in the company gets them while the plan lacks the feature.
 */
const PLAN_GATES: { [R in Resource]?: { feature: PlanFeature; actions?: readonly string[] } } = {
  customer: { feature: "customers" },
  promotion: { feature: "promotions" },
  inventory: { feature: "inventory" },
  expense: { feature: "expenses" },
  role: { feature: "customRoles", actions: ["create", "update", "delete"] },
  register: { feature: "dayClose" },
};

export function isPlanKey(value: unknown): value is PlanKey {
  return typeof value === "string" && (PLAN_KEYS as readonly string[]).includes(value);
}

export function planHas(plan: PlanKey, feature: PlanFeature): boolean {
  return (PLANS[plan].features as readonly PlanFeature[]).includes(feature);
}

export function planLimit(plan: PlanKey, limit: PlanLimit): number | null {
  return PLANS[plan].limits[limit];
}

/** Is `count` existing items still below the plan's limit (so one more can be created)? */
export function belowLimit(plan: PlanKey, limit: PlanLimit, count: number): boolean {
  const max = planLimit(plan, limit);
  return max === null || count < max;
}

/**
 * What a Server Action answers when creating one more item would go past the plan's limit.
 * Forms show it with `usePlanLimitMessage()` (`Plans.limits.<limit>` messages).
 */
export type PlanLimitError = { ok: false; error: "planLimit"; limit: PlanLimit; max: number };

export function planLimitError(plan: PlanKey, limit: PlanLimit): PlanLimitError {
  return { ok: false, error: "planLimit", limit, max: planLimit(plan, limit) ?? 0 };
}

/** What a Server Action answers when the plan does not include the feature at all. */
export type PlanFeatureError = { ok: false; error: "planFeature"; feature: PlanFeature };

export function planFeatureError(feature: PlanFeature): PlanFeatureError {
  return { ok: false, error: "planFeature", feature };
}

export function isPlanError(failure: { error: string }): failure is PlanLimitError | PlanFeatureError {
  return failure.error === "planLimit" || failure.error === "planFeature";
}

/** The role's permissions minus what the plan does not include (what the member can use). */
export function planPermissions(granted: Permissions, plan: PlanKey): Permissions {
  return normalizePermissions(
    Object.fromEntries(
      RESOURCES.map((resource) => {
        const actions: readonly string[] = granted[resource] ?? [];
        const gate = PLAN_GATES[resource];
        if (!gate || planHas(plan, gate.feature)) return [resource, actions];
        return [resource, gate.actions ? actions.filter((action) => !gate.actions?.includes(action)) : []];
      }),
    ),
  );
}

/** The plan features a permission request needs (empty = it is on every plan). */
export function featuresFor(request: PermissionRequest): PlanFeature[] {
  const features: PlanFeature[] = [];
  for (const [resource, actions] of Object.entries(request) as [Resource, readonly string[] | undefined][]) {
    const gate = PLAN_GATES[resource];
    if (!gate) continue;
    if (!gate.actions || (actions ?? []).some((action) => gate.actions?.includes(action))) features.push(gate.feature);
  }
  return [...new Set(features)];
}

/** The cheapest plan that has `feature` (for "available from Pro" hints). */
export function minimumPlanFor(feature: PlanFeature): PlanKey {
  return PLAN_KEYS.find((key) => planHas(key, feature)) ?? "business";
}

/** Plans ordered by rank: an upgrade goes to a later one, a downgrade to an earlier one. */
export function planRank(plan: PlanKey): number {
  return PLAN_KEYS.indexOf(plan);
}
