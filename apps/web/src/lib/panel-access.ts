import type { PermissionRequest } from "./permissions";

/**
 * The permission each merchant panel section needs to be seen. One map for the sidebar,
 * the home page and the section's page guard (`requirePanelSection` / `requireCompanySection`),
 * so a link and its page always agree. Pages inside a section (new, edit...) check their own,
 * stricter permission.
 */
export const PANEL_ACCESS = {
  // store sections (/dashboard/store/<storeId>/...)
  orders: { order: ["read"] },
  products: { product: ["read"] },
  categories: { category: ["read"] },
  promotions: { promotion: ["read"] },
  settings: { store: ["read"] },
  // company sections (/dashboard/org/<tenantId>/...)
  team: { team: ["read"] },
  roles: { role: ["read"] },
} as const satisfies Record<string, PermissionRequest>;

export type PanelSection = keyof typeof PANEL_ACCESS;
export type CompanySection = Extract<PanelSection, "team" | "roles">;
export type StoreSection = Exclude<PanelSection, CompanySection>;
