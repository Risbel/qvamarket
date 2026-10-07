import { cache } from "react";
import { notFound } from "next/navigation";
import { asc, db, eq, member, organization, store } from "@qvashop/db";
import { can, type PermissionRequest } from "@/lib/permissions";
import { requireUser } from "./session";

export type MerchantStore = {
  id: string;
  name: string;
  slug: string;
  currency: string;
  isActive: boolean;
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
        currency: store.currency,
        isActive: store.isActive,
      })
      .from(store)
      .where(eq(store.tenantId, membership.tenantId))
      .orderBy(asc(store.createdAt));
    if (stores.length === 0) return null;

    return { ...membership, store: stores[0], stores };
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
