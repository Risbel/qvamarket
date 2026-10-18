"use client";

import { useCallback } from "react";
import { useParams } from "next/navigation";
import { orgPath, storePath } from "@/lib/panel-paths";

// The company / store of the current panel URL, for client components: links and Server
// Action arguments (the server re-checks the membership on every call).

/** The store of the current URL (/dashboard/store/<storeId>/...). Only inside store pages. */
export function useStoreId(): string {
  const { storeId } = useParams<{ storeId?: string }>();
  if (!storeId) throw new Error("useStoreId() outside /dashboard/store/[storeId]");
  return storeId;
}

/** The company of the current URL (/dashboard/org/<orgId>/...). Only inside company pages. */
export function useOrgId(): string {
  const { orgId } = useParams<{ orgId?: string }>();
  if (!orgId) throw new Error("useOrgId() outside /dashboard/org/[orgId]");
  return orgId;
}

/** storePath() bound to the current store: `href={panelPath("/products")}`. Stable per store. */
export function useStorePath(): (path?: string) => string {
  const storeId = useStoreId();
  return useCallback((path = "") => storePath(storeId, path), [storeId]);
}

/** orgPath() bound to the current company. Stable per company. */
export function useOrgPath(): (path?: string) => string {
  const orgId = useOrgId();
  return useCallback((path = "") => orgPath(orgId, path), [orgId]);
}
