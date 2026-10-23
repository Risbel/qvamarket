"use client";

import { useCallback } from "react";
import { useTranslations } from "next-intl";
import type { PlanFeatureError, PlanLimitError } from "@/lib/plans";
import { useFeatureLockedText } from "./plan-provider";

/**
 * Text for a Server Action's `planLimit` / `planFeature` answer, e.g. "Your plan allows up to
 * 30 active products. Upgrade your plan to add more."
 */
export function usePlanErrorMessage() {
  const t = useTranslations("Plans");
  const locked = useFeatureLockedText();
  return useCallback(
    (error: PlanLimitError | PlanFeatureError) =>
      error.error === "planLimit" ? t(`limits.${error.limit}`, { max: error.max }) : locked(error.feature),
    [t, locked],
  );
}
