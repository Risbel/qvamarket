import { cache } from "react";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { asc, db, eq, member, organization, store } from "@qvashop/db";
import { auth } from "@/lib/auth";
import { can, type PermissionRequest } from "@/lib/permissions";
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
  role: string;
  /** the store the panel is working on (MVP: the company's first store) */
  store: MerchantStore;
  stores: MerchantStore[];
};

/**
 * The company (tenant) and stores of a user, or null when the user is not a member of
 * a company that has a store (e.g. the superadmin). Cached per request.
 * MVP: a user belongs to one company; when a company has several stores the oldest
 * one is active (a store switcher comes with the feature that creates more stores).
 */
export const getMerchantContext = cache(
  async (userId: string): Promise<MerchantContext | null> => {
    const [membership] = await db
      .select({
        tenantId: member.organizationId,
        role: member.role,
        companyName: organization.name,
      })
      .from(member)
      .innerJoin(organization, eq(organization.id, member.organizationId))
      .where(eq(member.userId, userId))
      .orderBy(asc(member.createdAt))
      .limit(1);
    if (!membership) return null;

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
    return { ...membership, store: typed[0], stores: typed };
  },
);

/**
 * Entry point of every merchant page and Server Action: signed in (and past the forced
 * password change), member of a company with a store. 404 otherwise (the superadmin has
 * no company). Tenant data must only be read/written with the returned `tenantId`.
 */
export async function requireMerchant(locale: string) {
  const session = await requireUser(locale);
  const context = await getMerchantContext(session.user.id);
  if (!context) notFound();
  return {
    session,
    ...context,
    /** Does the member's role grant ALL of these permissions? e.g. can({ product: ["update"] }) */
    can: (request: PermissionRequest) => can(context.role, request),
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
  const context = await getMerchantContext(session.user.id);
  if (!context) return null;
  return {
    session,
    ...context,
    can: (request: PermissionRequest) => can(context.role, request),
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
