"use client";

import { LockIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { minimumPlanFor, type PlanFeature } from "@/lib/plans";
import { Badge } from "@/components/ui/badge";
import { useHasFeature } from "./plan-provider";

/**
 * "Pro" next to a control the plan does not include (nothing when it does). The control itself
 * is disabled by its owner; this only says which plan has it.
 */
export function PlanBadge({ feature, className }: { feature: PlanFeature; className?: string }) {
  const t = useTranslations("Plans");
  const has = useHasFeature(feature);
  if (has) return null;
  const plan = t(`plans.${minimumPlanFor(feature)}.name`);
  return (
    <Badge variant="outline" className={className} title={t("featureLocked", { plan })}>
      <LockIcon aria-hidden />
      {plan}
      <span className="sr-only">{t("featureLocked", { plan })}</span>
    </Badge>
  );
}
