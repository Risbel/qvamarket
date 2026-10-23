import type { PLAN_FEATURES as DB_PLAN_FEATURES, PLAN_KEYS as DB_PLAN_KEYS } from "@qvashop/db/schema";
import { RESOURCES, normalizePermissions, type PermissionRequest, type Permissions, type Resource } from "./permissions";

/**
 * Plans: what a company gets for its subscription. Limits are defined here, once; which
 * features each plan includes and whether merchants can choose it live in the `plan_setting`
 * table (edited by the superadmin in /admin/prices, read with `getPlanCatalog()`), prices in
 * `plan_price`. Names and descriptions: `Plans.plans.<key>` messages.
 *
 * A plan is a gate on top of the roles: the role says who may use a section, the plan says
 * whether the company has it. Selling is never limited (no order quotas) and nothing is
 * deleted on a downgrade: data over a limit stays, only creating more is refused.
 *
 * Client-safe and pure.
 */
export const PLAN_KEYS = ["free", "basic", "pro", "business"] as const satisfies typeof DB_PLAN_KEYS;
export type PlanKey = (typeof PLAN_KEYS)[number];

/**
 * Plan features that are not a whole permission resource, plus those that are (see PLAN_GATES).
 * Adding one = here and in the schema's list (its CHECK) + a migration that adds it to the
 * `plan_setting` rows of the plans that should have it (otherwise no plan has it).
 */
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
] as const satisfies typeof DB_PLAN_FEATURES;
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

export type Plan = { limits: PlanLimits };

export const PLANS = {
  free: {
    limits: { stores: 1, activeProducts: 30, imagesPerProduct: 3, currencies: 1, bannerImages: 1, pages: 1, members: 0 },
  },
  basic: {
    limits: { stores: 1, activeProducts: 300, imagesPerProduct: 6, currencies: 2, bannerImages: 3, pages: 5, members: 2 },
  },
  pro: {
    limits: { stores: 3, activeProducts: 3000, imagesPerProduct: 6, currencies: 5, bannerImages: 5, pages: 20, members: 10 },
  },
  business: {
    limits: { stores: 10, activeProducts: null, imagesPerProduct: 6, currencies: 10, bannerImages: 5, pages: 20, members: 50 },
  },
} as const satisfies Record<PlanKey, Plan>;

/**
 * What each plan includes and whether merchants can choose it (`plan_setting`). A plan that is
 * not offered is left out of the merchants' plan comparison and cannot be scheduled or asked
 * for; companies already on it keep it, and the superadmin can still assign it.
 */
export type PlanSetting = { features: readonly PlanFeature[]; offered: boolean };
export type PlanCatalog = Record<PlanKey, PlanSetting>;

/** Every plan offered with no features: the base `getPlanCatalog()` fills (and the client's default outside a panel). */
export function emptyPlanCatalog(): PlanCatalog {
  const none = { features: [], offered: true };
  return { free: none, basic: none, pro: none, business: none };
}

export function isPlanFeature(value: unknown): value is PlanFeature {
  return typeof value === "string" && (PLAN_FEATURES as readonly string[]).includes(value);
}

export function catalogHas(catalog: PlanCatalog, plan: PlanKey, feature: PlanFeature): boolean {
  return catalog[plan].features.includes(feature);
}

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

/** The role's permissions minus what the plan (its `features`) does not include (what the member can use). */
export function planPermissions(granted: Permissions, features: readonly PlanFeature[]): Permissions {
  return normalizePermissions(
    Object.fromEntries(
      RESOURCES.map((resource) => {
        const actions: readonly string[] = granted[resource] ?? [];
        const gate = PLAN_GATES[resource];
        if (!gate || features.includes(gate.feature)) return [resource, actions];
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

/**
 * The cheapest offered plan that has `feature` (for "available from Pro" hints), else the
 * cheapest plan that has it at all, or null when no plan includes it.
 */
export function minimumPlanFor(catalog: PlanCatalog, feature: PlanFeature): PlanKey | null {
  const having = PLAN_KEYS.filter((key) => catalogHas(catalog, key, feature));
  return having.find((key) => catalog[key].offered) ?? having[0] ?? null;
}

/** Plans ordered by rank: an upgrade goes to a later one, a downgrade to an earlier one. */
export function planRank(plan: PlanKey): number {
  return PLAN_KEYS.indexOf(plan);
}
