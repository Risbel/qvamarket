"use client";

import type { ReactNode } from "react";
import { LockKeyhole } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "cn";
import type { PermissionRequest } from "@/lib/permissions";
import { usePermission } from "./permissions-provider";

/**
 * Read-only mode for a whole form: without `permission` every control inside a native
 * `<fieldset disabled>` is disabled and a notice says why. Controls that are not native form
 * elements (some Base UI parts) may ignore the fieldset: pass them `disabled` from
 * usePermission. The Server Action still refuses the write on its own.
 * `lockedReason`: read-only for another reason than a missing permission (shown instead).
 */
export function PermissionFieldset({
  permission,
  lockedReason,
  className,
  children,
}: {
  permission: PermissionRequest;
  lockedReason?: string;
  className?: string;
  children: ReactNode;
}) {
  const t = useTranslations("Panel.permissions");
  const permitted = usePermission(permission);
  const allowed = permitted && !lockedReason;
  return (
    <>
      {!allowed && (
        <p className="flex items-center gap-2 rounded-md border bg-muted px-3 py-2 text-sm text-muted-foreground">
          <LockKeyhole className="size-4 shrink-0" aria-hidden />
          {permitted ? lockedReason : t("readOnly")}
        </p>
      )}
      <fieldset disabled={!allowed} className={cn("min-w-0", className)}>
        {children}
      </fieldset>
    </>
  );
}
