"use client";

import { createContext, useCallback, useContext, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { FALLBACK_PLAN, emptyPlanCatalog, minimumPlanFor, planLimit, type PlanCatalog, type PlanFeature, type PlanKey, type PlanLimit } from "@/lib/plans";

/**
 * The company's current plan and every plan's features (`plan_setting`), resolved on the
 * server (getCompanyContext) and handed to the panel's client components, so forms can cap
 * pickers and lock options before the server refuses. UX only: every Server Action checks
 * the plan again.
 */
const PlanContext = createContext<{ plan: PlanKey; catalog: PlanCatalog } | null>(null);

// Outside a panel: the free plan with no features
const EMPTY_CATALOG = emptyPlanCatalog();

export function PlanProvider({ plan, catalog, children }: { plan: PlanKey; catalog: PlanCatalog; children: ReactNode }) {
  return <PlanContext value={{ plan, catalog }}>{children}</PlanContext>;
}

/** The plan that applies now (the free plan outside a panel). */
export function usePlan(): PlanKey {
  return useContext(PlanContext)?.plan ?? FALLBACK_PLAN;
}

function useCatalog(): PlanCatalog {
  return useContext(PlanContext)?.catalog ?? EMPTY_CATALOG;
}

export function useHasFeature(feature: PlanFeature): boolean {
  return useCatalog()[usePlan()].features.includes(feature);
}

/** The cheapest plan that has `feature` (null: no plan has it right now). */
export function useMinimumPlan(feature: PlanFeature): PlanKey | null {
  return minimumPlanFor(useCatalog(), feature);
}

/** "Your plan does not include this feature. It is available from the Pro plan." for any feature. */
export function useFeatureLockedText() {
  const t = useTranslations("Plans");
  const catalog = useCatalog();
  return useCallback(
    (feature: PlanFeature) => {
      const plan = minimumPlanFor(catalog, feature);
      return plan ? t("featureLocked", { plan: t(`plans.${plan}.name`) }) : t("featureUnavailable");
    },
    [catalog, t],
  );
}

/** The plan's limit, or `fallback` (the platform's own cap) when the plan sets none. */
export function usePlanLimit(limit: PlanLimit, fallback: number): number {
  const max = planLimit(usePlan(), limit);
  return max === null ? fallback : Math.min(max, fallback);
}
