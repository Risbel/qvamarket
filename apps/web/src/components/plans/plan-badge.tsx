"use client";

import { LockIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import type { PlanFeature } from "@/lib/plans";
import { Badge } from "@/components/ui/badge";
import { useFeatureLockedText, useHasFeature, useMinimumPlan } from "./plan-provider";

/**
 * "Pro" next to a control the plan does not include (nothing when it does). The control itself
 * is disabled by its owner; this only says which plan has it.
 */
export function PlanBadge({ feature, className }: { feature: PlanFeature; className?: string }) {
  const t = useTranslations("Plans");
  const has = useHasFeature(feature);
  const minimum = useMinimumPlan(feature);
  const locked = useFeatureLockedText()(feature);
  if (has) return null;
  return (
    <Badge variant="outline" className={className} title={locked}>
      <LockIcon aria-hidden />
      {minimum ? t(`plans.${minimum}.name`) : t("unavailable")}
      <span className="sr-only">{locked}</span>
    </Badge>
  );
}
