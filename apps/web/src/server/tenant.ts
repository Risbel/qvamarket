import { cache } from "react";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { z } from "zod";
import { asc, db, eq, member, organization, store } from "@qvashop/db";
import { auth } from "@/lib/auth";
import { hasPermissions, isOwner, type PermissionRequest, type Permissions } from "@/lib/permissions";
import { featuresFor, planHas, planPermissions, type PlanFeature } from "@/lib/plans";
import { storePath } from "@/lib/panel-paths";
import { redirect } from "@/i18n/navigation";
import type { EffectiveSubscription } from "@/lib/billing";
import { PANEL_ACCESS, type CompanySection, type StoreSection } from "@/lib/panel-access";
import type { StoreAccess } from "@/lib/store-access";
import { storeTimeZone } from "@/lib/date-range";
import { memberPermissions } from "./company-roles";
import { memberStoreAccess } from "./store-access";
import { getStoreCurrencies, type StoreCurrency } from "./currencies";
import { getCompanySubscription } from "./subscriptions";
import { requireUser } from "./session";

// The merchant panel's URLs carry the company (/dashboard/org/<tenantId>/...) and the store
// (/dashboard/store/<storeId>/...). Those ids come from the browser, so they only SELECT what
// to show: every page and Server Action resolves them here, which checks that the signed-in
// user is a member of that company (and that the store belongs to it) and returns the
// member's permissions. Unknown ids, other companies' ids and malformed ids are all null / 404.

const isUuid = (value: unknown): value is string => z.uuid().safeParse(value).success;

export type CompanyStore = {
  id: string;
  name: string;
  slug: string;
  /** pending (awaiting approval) | active | suspended */
  status: "pending" | "active" | "suspended";
  logoKey: string | null;
  logotypeKey: string | null;
  primaryColor: string | null;
  accentColor: string | null;
  themeRadius: string | null;
  themeBase: string | null;
  themeTinted: boolean;
};

export type MerchantStore = CompanyStore & {
  /** currencies the store sells in, default first */
  currencies: StoreCurrency[];
  defaultCurrency: StoreCurrency;
  /** the currency prices are typed in; the others follow it through their rates */
  baseCurrency: StoreCurrency;
  /** IANA zone of the business: reports count the store's days in it */
  timeZone: string;
};

export type MerchantCompany = { id: string; name: string };

export type CompanyContext = {
  /** organization.id: pass it to EVERY query on tenant data */
  tenantId: string;
  companyName: string;
  /** member.role: role keys, comma-separated ("owner", "manager", "r-...") */
  role: string;
  /** the built-in owner role: only owners create stores (not a permission, cannot be granted) */
  isOwner: boolean;
  /**
   * what the member's role(s) grant, whatever the plan: only for team and role management
   * (no-escalation checks). Feature code uses `can`, which also applies the plan.
   */
  permissions: Permissions;
  /** `permissions` minus what the company's plan does not include: what the member can use */
  effectivePermissions: Permissions;
  /** the company's subscription right now (plan whose features and limits apply, status) */
  subscription: EffectiveSubscription;
  /** which stores the member can open (owners: all); `stores` is already filtered by it */
  storeAccess: StoreAccess;
  /** member.id of the signed-in user in this company */
  memberId: string;
  /** the company's stores the member can open, oldest first (may be empty) */
  stores: CompanyStore[];
  /** every company the user is a member of, oldest membership first (the switcher) */
  companies: MerchantCompany[];
};

export type MerchantContext = CompanyContext & {
  /** the store of the URL */
  store: MerchantStore;
};

/** Every company the user is a member of, oldest membership first. Cached per request. */
export const getUserCompanies = cache(async (userId: string) => {
  return db
    .select({ id: member.organizationId, name: organization.name, role: member.role, memberId: member.id })
    .from(member)
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(eq(member.userId, userId))
    .orderBy(asc(member.createdAt));
});

/**
 * The company `tenantId` as seen by `userId`, or null when the user is not a member of it.
 * Cached per request.
 */
export const getCompanyContext = cache(
  async (userId: string, tenantId: string): Promise<CompanyContext | null> => {
    if (!isUuid(tenantId)) return null;
    const memberships = await getUserCompanies(userId);
    const membership = memberships.find((m) => m.id === tenantId.toLowerCase());
    if (!membership) return null;

    const [stores, permissions, storeAccess, subscription] = await Promise.all([
      db
        .select({
          id: store.id,
          name: store.name,
          slug: store.slug,
          status: store.status,
          logoKey: store.logoKey,
          logotypeKey: store.logotypeKey,
          primaryColor: store.primaryColor,
          accentColor: store.accentColor,
          themeRadius: store.themeRadius,
          themeBase: store.themeBase,
          themeTinted: store.themeTinted,
        })
        .from(store)
        .where(eq(store.tenantId, membership.id))
        .orderBy(asc(store.createdAt)),
      memberPermissions(membership.id, membership.role),
      memberStoreAccess(db, membership.id, membership.memberId, membership.role),
      getCompanySubscription(membership.id),
    ]);
    return {
      tenantId: membership.id,
      companyName: membership.name,
      role: membership.role,
      isOwner: isOwner(membership.role),
      permissions,
      effectivePermissions: planPermissions(permissions, subscription.plan),
      subscription,
      memberId: membership.memberId,
      storeAccess,
      // A store outside the member's access does not exist for them (404, not listed).
      // The DB CHECK guarantees status is one of the three values.
      stores: stores
        .filter((s) => storeAccess.all || storeAccess.storeIds.includes(s.id))
        .map((s) => ({ ...s, status: s.status as CompanyStore["status"] })),
      companies: memberships.map(({ id, name }) => ({ id, name })),
    };
  },
);

/**
 * The store `storeId` as seen by `userId` (with its company), or null when the store does not
 * exist or the user is not a member of its company. Cached per request.
 */
export const getMerchantContext = cache(
  async (userId: string, storeId: string): Promise<MerchantContext | null> => {
    if (!isUuid(storeId)) return null;
    const [row] = await db
      .select({ tenantId: store.tenantId, timeZone: store.timeZone })
      .from(store)
      .where(eq(store.id, storeId.toLowerCase()))
      .limit(1);
    if (!row) return null;
    const company = await getCompanyContext(userId, row.tenantId);
    const found = company?.stores.find((s) => s.id === storeId.toLowerCase());
    if (!company || !found) return null;

    const list = (await getStoreCurrencies([found.id])).get(found.id) ?? [];
    // Every store has a default currency (created with the store); the fallback only guards
    // against a broken row.
    const fallback = { code: "USD", digits: 2, isDefault: true, isBase: true, rate: null, roundingMinor: null };
    return {
      ...company,
      store: {
        ...found,
        currencies: list.length > 0 ? list : [fallback],
        defaultCurrency: list.find((c) => c.isDefault) ?? list[0] ?? fallback,
        baseCurrency: list.find((c) => c.isBase) ?? list.find((c) => c.isDefault) ?? list[0] ?? fallback,
        timeZone: storeTimeZone(row.timeZone),
      },
    };
  },
);

/**
 * The company `/dashboard` opens: the session's active company (last one chosen with the
 * switcher, or opened by an invitation / impersonation) while the user is still a member
 * there, otherwise their oldest membership. null = no company (e.g. the superadmin).
 */
export async function defaultCompanyId(userId: string, activeTenantId: string | null | undefined) {
  const companies = await getUserCompanies(userId);
  return (companies.find((c) => c.id === activeTenantId) ?? companies[0])?.id ?? null;
}

/** Signed-in session for Server Actions, or null (signed out, temporary password). Never throws. */
async function actionSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;
  if (session.user.mustChangePassword && !session.session.impersonatedBy) return null;
  return session;
}

function withCan<T extends CompanyContext>(context: T) {
  return {
    ...context,
    /**
     * Does the member's role grant ALL of these permissions, and does the company's plan
     * include them? e.g. can({ product: ["update"] })
     */
    can: (request: PermissionRequest) => hasPermissions(context.effectivePermissions, request),
    /** Does the company's plan include this feature? */
    hasFeature: (feature: PlanFeature) => planHas(context.subscription.plan, feature),
    /**
     * The plan feature that keeps the member from `request` although their role grants it
     * (an upgrade would open it), or null (allowed, or the role does not grant it anyway).
     */
    planLock: (request: PermissionRequest): PlanFeature | null => {
      if (!hasPermissions(context.permissions, request) || hasPermissions(context.effectivePermissions, request)) return null;
      return featuresFor(request).find((feature) => !planHas(context.subscription.plan, feature)) ?? null;
    },
  };
}

// ---------------------------------------------------------------------------------------
// Store pages and actions (/dashboard/store/<storeId>/...)
// ---------------------------------------------------------------------------------------

/**
 * Entry point of every store page: signed in (and past the forced password change), member
 * of the company that owns `storeId`. 404 otherwise. Tenant data must only be read/written
 * with the returned `tenantId` and `store.id`.
 */
export async function requireMerchant(locale: string, storeId: string) {
  const session = await requireUser(locale);
  const context = await getMerchantContext(session.user.id, storeId);
  if (!context) notFound();
  return { session, ...withCan(context) };
}

/**
 * Same checks as requireMerchant but never redirects or throws: null when the caller is not
 * a member of the store's company. For Server Actions, which answer "forbidden" instead.
 */
export async function getMerchantOrNull(storeId: unknown) {
  if (!isUuid(storeId)) return null;
  const session = await actionSession();
  if (!session) return null;
  const context = await getMerchantContext(session.user.id, storeId);
  if (!context) return null;
  return { session, ...withCan(context) };
}

/**
 * requireMerchant + a required permission; a missing permission is a 404. When only the plan
 * stands in the way (the role grants it), the member goes to the store's upgrade page instead.
 */
export async function requireMerchantPermission(locale: string, storeId: string, request: PermissionRequest) {
  const merchant = await requireMerchant(locale, storeId);
  if (!merchant.can(request)) {
    const feature = merchant.planLock(request);
    if (feature) redirect({ href: storePath(merchant.store.id, `/upgrade?feature=${feature}`), locale });
    notFound();
  }
  return merchant;
}

/** requireMerchantPermission with the section's permission from PANEL_ACCESS. */
export async function requirePanelSection(locale: string, storeId: string, section: StoreSection) {
  return requireMerchantPermission(locale, storeId, PANEL_ACCESS[section]);
}

// ---------------------------------------------------------------------------------------
// Company pages and actions (/dashboard/org/<tenantId>/...): stores, team, roles
// ---------------------------------------------------------------------------------------

/** Entry point of every company page: member of `tenantId`, 404 otherwise. */
export async function requireCompany(locale: string, tenantId: string) {
  const session = await requireUser(locale);
  const context = await getCompanyContext(session.user.id, tenantId);
  if (!context) notFound();
  return { session, ...withCan(context) };
}

/** requireCompany for Server Actions: null instead of a 404. */
export async function getCompanyOrNull(tenantId: unknown) {
  if (!isUuid(tenantId)) return null;
  const session = await actionSession();
  if (!session) return null;
  const context = await getCompanyContext(session.user.id, tenantId);
  if (!context) return null;
  return { session, ...withCan(context) };
}

/** requireCompany + a required permission; a missing permission is a 404. */
export async function requireCompanyPermission(locale: string, tenantId: string, request: PermissionRequest) {
  const company = await requireCompany(locale, tenantId);
  if (!company.can(request)) notFound();
  return company;
}

/** requireCompanyPermission with the section's permission from PANEL_ACCESS. */
export async function requireCompanySection(locale: string, tenantId: string, section: CompanySection) {
  return requireCompanyPermission(locale, tenantId, PANEL_ACCESS[section]);
}
