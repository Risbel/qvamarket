"use client";

import { createContext, useContext, type ReactNode } from "react";
import { FALLBACK_PLAN, planHas, planLimit, type PlanFeature, type PlanKey, type PlanLimit } from "@/lib/plans";

/**
 * The company's current plan, resolved on the server (getCompanyContext) and handed to the
 * panel's client components, so forms can cap pickers and lock options before the server
 * refuses. UX only: every Server Action checks the plan again.
 */
const PlanContext = createContext<PlanKey | null>(null);

export function PlanProvider({ plan, children }: { plan: PlanKey; children: ReactNode }) {
  return <PlanContext value={plan}>{children}</PlanContext>;
}

/** The plan that applies now (the free plan outside a panel). */
export function usePlan(): PlanKey {
  return useContext(PlanContext) ?? FALLBACK_PLAN;
}

export function useHasFeature(feature: PlanFeature): boolean {
  return planHas(usePlan(), feature);
}

/** The plan's limit, or `fallback` (the platform's own cap) when the plan sets none. */
export function usePlanLimit(limit: PlanLimit, fallback: number): number {
  const max = planLimit(usePlan(), limit);
  return max === null ? fallback : Math.min(max, fallback);
}
