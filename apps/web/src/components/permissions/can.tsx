"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { PermissionRequest } from "@/lib/permissions";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { usePermission } from "./permissions-provider";

/**
 * Renders its children only when the member has `permission` (otherwise `fallback`).
 * With a function as children it always renders and passes `allowed`, for controls that
 * stay visible but disabled:
 *
 *   <Can permission={{ product: ["delete"] }}>
 *     {(allowed) => (
 *       <PermissionTooltip allowed={allowed}>
 *         <Button disabled={!allowed}>…</Button>
 *       </PermissionTooltip>
 *     )}
 *   </Can>
 *
 * Hiding is not authorization: the Server Action must check the permission too.
 */
export function Can({
  permission,
  fallback = null,
  children,
}: {
  permission: PermissionRequest;
  fallback?: ReactNode;
  children: ReactNode | ((allowed: boolean) => ReactNode);
}) {
  const allowed = usePermission(permission);
  if (typeof children === "function") return children(allowed);
  return allowed ? children : fallback;
}

/**
 * Explains a control disabled for lack of permission with a tooltip. A disabled button
 * receives no pointer events, so the tooltip is attached to a focusable wrapper.
 */
export function PermissionTooltip({ allowed, children }: { allowed: boolean; children: ReactNode }) {
  const t = useTranslations("Panel.permissions");
  if (allowed) return children;
  return (
    <Tooltip>
      <TooltipTrigger render={<span tabIndex={0} className="inline-flex" />}>{children}</TooltipTrigger>
      <TooltipContent>{t("denied")}</TooltipContent>
    </Tooltip>
  );
}
