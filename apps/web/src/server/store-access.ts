import { and, db, eq, inArray, memberAccess, memberStore, store } from "@qvashop/db";
import { isOwner } from "@/lib/permissions";
import { ALL_STORES, accessWithin, type StoreAccess } from "@/lib/store-access";
import type { Tx } from "./company-roles";

// Store access of team members (member_access + member_store). The tenantId always comes
// from getCompanyOrNull() / requireCompany(); member ids are checked against it.

type Executor = typeof db | Tx;

/** The store access of every member of the company (owners: all stores). */
export async function listMemberAccess(
  executor: Executor,
  tenantId: string,
  members: { id: string; role: string }[],
): Promise<Map<string, StoreAccess>> {
  const result = new Map<string, StoreAccess>(members.map((m) => [m.id, ALL_STORES]));
  const restricted = members.filter((m) => !isOwner(m.role)).map((m) => m.id);
  if (restricted.length === 0) return result;
  const [scopes, stores] = await Promise.all([
    executor
      .select({ memberId: memberAccess.memberId, scope: memberAccess.scope })
      .from(memberAccess)
      .where(and(eq(memberAccess.tenantId, tenantId), inArray(memberAccess.memberId, restricted))),
    executor
      .select({ memberId: memberStore.memberId, storeId: memberStore.storeId })
      .from(memberStore)
      .where(and(eq(memberStore.tenantId, tenantId), inArray(memberStore.memberId, restricted))),
  ]);
  for (const { memberId, scope } of scopes) {
    if (scope === "stores") {
      result.set(memberId, { all: false, storeIds: stores.filter((s) => s.memberId === memberId).map((s) => s.storeId) });
    }
  }
  return result;
}

/** One member's store access (owners: all stores). */
export async function memberStoreAccess(
  executor: Executor,
  tenantId: string,
  memberId: string,
  role: string,
): Promise<StoreAccess> {
  return (await listMemberAccess(executor, tenantId, [{ id: memberId, role }])).get(memberId) ?? ALL_STORES;
}

export type AccessCheck = "storeNotFound" | "escalation" | null;

/** Can `actorAccess` give `requested`? (its stores are the company's, and within the actor's) */
export async function checkAccessGrantable(
  executor: Executor,
  tenantId: string,
  actorAccess: StoreAccess,
  requested: StoreAccess,
): Promise<AccessCheck> {
  if (!requested.all && requested.storeIds.length > 0) {
    const found = await executor
      .select({ id: store.id })
      .from(store)
      .where(and(eq(store.tenantId, tenantId), inArray(store.id, requested.storeIds)));
    if (found.length !== new Set(requested.storeIds).size) return "storeNotFound";
  }
  return accessWithin(actorAccess, requested) ? null : "escalation";
}

/** Replaces a member's store access (inside the caller's transaction, under the company lock). */
export async function setMemberStoreAccess(tx: Tx, tenantId: string, memberId: string, access: StoreAccess) {
  await tx
    .insert(memberAccess)
    .values({ memberId, tenantId, scope: access.all ? "all" : "stores" })
    .onConflictDoUpdate({ target: memberAccess.memberId, set: { scope: access.all ? "all" : "stores", updatedAt: new Date() } });
  await tx.delete(memberStore).where(and(eq(memberStore.tenantId, tenantId), eq(memberStore.memberId, memberId)));
  if (!access.all && access.storeIds.length > 0) {
    await tx.insert(memberStore).values([...new Set(access.storeIds)].map((storeId) => ({ memberId, storeId, tenantId })));
  }
}
