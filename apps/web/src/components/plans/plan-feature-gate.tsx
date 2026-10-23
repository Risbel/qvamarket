"use client";

import type { ReactNode } from "react";
import { LockIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { minimumPlanFor, type PlanFeature } from "@/lib/plans";
import { InheritedDisabled } from "@/components/inherited-disabled";
import { cn } from "@/lib/utils";
import { useHasFeature } from "./plan-provider";

/**
 * A part of a form the plan does not include: its controls are disabled (a native fieldset,
 * plus <InheritedDisabled> for Base UI's span controls) under a notice saying which plan has
 * it. With the feature it renders the children as they are. The Server Action refuses or
 * ignores the input on its own.
 */
export function PlanFeatureGate({ feature, className, children }: { feature: PlanFeature; className?: string; children: ReactNode }) {
  const t = useTranslations("Plans");
  const has = useHasFeature(feature);
  if (has) return <>{children}</>;
  return (
    <div className={cn("flex flex-col gap-3 rounded-lg border border-dashed p-3", className)}>
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <LockIcon className="size-4 shrink-0" aria-hidden />
        {t("featureLocked", { plan: t(`plans.${minimumPlanFor(feature)}.name`) })}
      </p>
      <fieldset disabled className="flex min-w-0 flex-col gap-6 opacity-70">
        <InheritedDisabled disabled>{children}</InheritedDisabled>
      </fieldset>
    </div>
  );
}
