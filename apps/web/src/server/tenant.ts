import { cache } from "react";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { and, asc, db, eq, member, organization, sql, store } from "@qvashop/db";
import { auth } from "@/lib/auth";
import { hasPermissions, type PermissionRequest, type Permissions } from "@/lib/permissions";
import { PANEL_ACCESS, type PanelSection } from "@/lib/panel-access";
import { memberPermissions } from "./company-roles";
import { getStoreCurrencies, type StoreCurrency } from "./currencies";
import { requireUser } from "./session";

export type MerchantStore = {
  id: string;
  name: string;
  slug: string;
  /** currencies the store sells in, default first */
  currencies: StoreCurrency[];
  defaultCurrency: StoreCurrency;
  /** the currency prices are typed in; the others follow it through their rates */
  baseCurrency: StoreCurrency;
  /** pending (awaiting approval) | active | suspended */
  status: "pending" | "active" | "suspended";
  logoKey: string | null;
  logotypeKey: string | null;
  primaryColor: string | null;
  accentColor: string | null;
};

export type MerchantContext = {
  /** organization.id: pass it to EVERY query on tenant data */
  tenantId: string;
  companyName: string;
  /** member.role: role keys, comma-separated ("owner", "manager", "r-...") */
  role: string;
  /** what the member's role(s) grant; check it with `can`, never the role name */
  permissions: Permissions;
  /** the store the panel is working on (MVP: the company's first store) */
  store: MerchantStore;
  stores: MerchantStore[];
  /** every company (with a store) the user is a member of, oldest membership first */
  companies: { id: string; name: string }[];
};

/**
 * The company (tenant) and stores a user is working on, or null when the user is not a
 * member of any company that has a store (e.g. the superadmin). Cached per request.
 * A user can belong to several companies (one membership and role in each): the active one
 * is `activeTenantId` (the session's active_organization_id, set by the company switcher)
 * while they are still a member there, otherwise their oldest membership. When a company
 * has several stores the oldest one is active (no store switcher yet).
 */
export const getMerchantContext = cache(
  async (userId: string, activeTenantId: string | null | undefined): Promise<MerchantContext | null> => {
    const memberships = await db
      .select({
        tenantId: member.organizationId,
        role: member.role,
        companyName: organization.name,
      })
      .from(member)
      .innerJoin(organization, eq(organization.id, member.organizationId))
      // only companies that have a store (a company without one has no panel)
      .where(
        and(
          eq(member.userId, userId),
          sql`exists (select 1 from ${store} where ${store.tenantId} = ${member.organizationId})`,
        ),
      )
      .orderBy(asc(member.createdAt));
    const membership = memberships.find((m) => m.tenantId === activeTenantId) ?? memberships[0];
    if (!membership) return null;
    const companies = memberships.map((m) => ({ id: m.tenantId, name: m.companyName }));

    const stores = await db
      .select({
        id: store.id,
        name: store.name,
        slug: store.slug,
        status: store.status,
        logoKey: store.logoKey,
        logotypeKey: store.logotypeKey,
        primaryColor: store.primaryColor,
        accentColor: store.accentColor,
      })
      .from(store)
      .where(eq(store.tenantId, membership.tenantId))
      .orderBy(asc(store.createdAt));
    if (stores.length === 0) return null;

    const currencies = await getStoreCurrencies(stores.map((s) => s.id));
    // The DB CHECK guarantees status is one of the three values. Every store has a default
    // currency (created with the store); the fallback only guards against a broken row.
    const typed = stores.map((s): MerchantStore => {
      const list = currencies.get(s.id) ?? [];
      const fallback = { code: "USD", digits: 2, isDefault: true, isBase: true, rate: null, roundingMinor: null };
      return {
        ...s,
        status: s.status as MerchantStore["status"],
        currencies: list.length > 0 ? list : [fallback],
        defaultCurrency: list.find((c) => c.isDefault) ?? list[0] ?? fallback,
        baseCurrency: list.find((c) => c.isBase) ?? list.find((c) => c.isDefault) ?? list[0] ?? fallback,
      };
    });
    const permissions = await memberPermissions(membership.tenantId, membership.role);
    return { ...membership, permissions, store: typed[0], stores: typed, companies };
  },
);

/**
 * Entry point of every merchant page and Server Action: signed in (and past the forced
 * password change), member of a company with a store. 404 otherwise (the superadmin has
 * no company). Tenant data must only be read/written with the returned `tenantId`.
 */
export async function requireMerchant(locale: string) {
  const session = await requireUser(locale);
  const context = await getMerchantContext(session.user.id, session.session.activeOrganizationId);
  if (!context) notFound();
  return {
    session,
    ...context,
    /** Does the member's role grant ALL of these permissions? e.g. can({ product: ["update"] }) */
    can: (request: PermissionRequest) => hasPermissions(context.permissions, request),
  };
}

/**
 * Same checks as requireMerchant but never redirects or throws: returns null when the
 * caller is not a merchant member (signed out, temporary password, no company).
 * For Server Actions, which answer "forbidden" instead of rendering a 404.
 */
export async function getMerchantOrNull() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;
  if (session.user.mustChangePassword && !session.session.impersonatedBy) return null;
  const context = await getMerchantContext(session.user.id, session.session.activeOrganizationId);
  if (!context) return null;
  return {
    session,
    ...context,
    can: (request: PermissionRequest) => hasPermissions(context.permissions, request),
  };
}

/**
 * requireMerchant + a required permission. Pages call this; a missing permission is a 404
 * (the page is not revealed). Server Actions should use requireMerchant and return
 * "forbidden" when `can(...)` is false.
 */
export async function requireMerchantPermission(
  locale: string,
  request: PermissionRequest,
) {
  const merchant = await requireMerchant(locale);
  if (!merchant.can(request)) notFound();
  return merchant;
}

/** requireMerchantPermission with the section's permission from PANEL_ACCESS. */
export async function requirePanelSection(locale: string, section: PanelSection) {
  return requireMerchantPermission(locale, PANEL_ACCESS[section]);
}
