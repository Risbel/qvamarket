"use client";

import { createContext, useCallback, useContext, type ReactNode } from "react";
import { hasPermissions, type PermissionRequest, type Permissions } from "@/lib/permissions";

/**
 * The signed-in member's permissions, resolved on the server (getMerchantContext) and handed
 * to the panel's client components. UX only: it decides what to hide or disable, while every
 * page and Server Action checks the permission again on the server.
 */
const PermissionsContext = createContext<Permissions | null>(null);

export function PermissionsProvider({
  permissions,
  children,
}: {
  permissions: Permissions;
  children: ReactNode;
}) {
  return <PermissionsContext value={permissions}>{children}</PermissionsContext>;
}

/** A `can(request)` function for the current member. Must be inside <PermissionsProvider>. */
export function useCan() {
  const permissions = useContext(PermissionsContext);
  if (!permissions) throw new Error("useCan must be used inside <PermissionsProvider>");
  return useCallback((request: PermissionRequest) => hasPermissions(permissions, request), [permissions]);
}

/** Does the current member have every permission of `request`? */
export function usePermission(request: PermissionRequest) {
  return useCan()(request);
}
