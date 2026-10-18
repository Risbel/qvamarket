// Merchant panel URLs. The company and the store live in the path, so every link says what it
// is for (shareable, one tab per store). Build panel links only with these helpers, so the URL
// shape can change in one place. Client-safe.

/** /dashboard/org/<tenantId><path>: the company's pages (stores, team, roles). */
export function orgPath(tenantId: string, path = ""): string {
  return `/dashboard/org/${tenantId}${path}`;
}

/** /dashboard/store/<storeId><path>: a store's pages (orders, catalog, settings). */
export function storePath(storeId: string, path = ""): string {
  return `/dashboard/store/${storeId}${path}`;
}
