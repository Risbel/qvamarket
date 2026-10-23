"use client";

import { useCallback } from "react";
import { useTranslations } from "next-intl";
import { minimumPlanFor, type PlanFeatureError, type PlanLimitError } from "@/lib/plans";

/**
 * Text for a Server Action's `planLimit` / `planFeature` answer, e.g. "Your plan allows up to
 * 30 active products. Upgrade your plan to add more."
 */
export function usePlanErrorMessage() {
  const t = useTranslations("Plans");
  return useCallback(
    (error: PlanLimitError | PlanFeatureError) =>
      error.error === "planLimit"
        ? t(`limits.${error.limit}`, { max: error.max })
        : t("featureLocked", { plan: t(`plans.${minimumPlanFor(error.feature)}.name`) }),
    [t],
  );
}
