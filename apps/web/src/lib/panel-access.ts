import type { PermissionRequest } from "./permissions";

/**
 * The permission each merchant panel section needs to be seen. One map for the sidebar,
 * the home page and the section's page guard (`requirePanelSection`), so a link and its page
 * always agree. Pages inside a section (new, edit...) check their own, stricter permission.
 */
export const PANEL_ACCESS = {
  orders: { order: ["read"] },
  products: { product: ["read"] },
  categories: { category: ["update"] },
  promotions: { promotion: ["update"] },
  settings: { store: ["update"] },
} as const satisfies Record<string, PermissionRequest>;

export type PanelSection = keyof typeof PANEL_ACCESS;
