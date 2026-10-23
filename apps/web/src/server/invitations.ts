import { and, companyRole, count, db, desc, eq, gt, inArray, invitation, invitationAccess, member, organization, store, user } from "@qvashop/db";
import { INVITATION_DAYS, MAX_PENDING_INVITATIONS } from "@/lib/invitations";
import { hasPermissions, normalizePermissions } from "@/lib/permissions";
import type { PlanKey, PlanLimitError } from "@/lib/plans";
import { ALL_STORES, accessWithin, type StoreAccess } from "@/lib/store-access";
import { toStoreAccess, type InvitationValues } from "@/lib/validation/team";
import { lockCompany, memberPermissions } from "./company-roles";
import { checkAccessGrantable, memberStoreAccess, setMemberStoreAccess } from "./store-access";
import { checkGrantable, checkMemberRoom, type TeamActor } from "./team";
import { getCompanySubscription } from "./subscriptions";

// Invitations let a company add a person who ALREADY has a QvaShop account, without touching
// that account: the person opens the link, signs in with their own password and accepts.
// Rows live in Better Auth's `invitation` table, written only from here (the plugin's
// invitation endpoints are disabled). A link only works for the invited email, once, before
// it expires, and only while the inviter could still give that role and those stores. The
// store access it gives lives in invitation_access (null = all stores).

const PENDING = "pending";

export type InvitationRow = {
  id: string;
  email: string;
  roleKey: string;
  roleName: string | null;
  inviterName: string;
  expiresAt: Date;
  storeAccess: StoreAccess;
};

/** The store access an invitation gives (no row: all stores, like invitations from before). */
async function invitationStoreAccess(executor: Pick<typeof db, "select">, ids: string[]) {
  const rows =
    ids.length === 0
      ? []
      : await executor
          .select({ id: invitationAccess.invitationId, storeIds: invitationAccess.storeIds })
          .from(invitationAccess)
          .where(inArray(invitationAccess.invitationId, ids));
  const byId = new Map(rows.map((r) => [r.id, r.storeIds]));
  return (id: string): StoreAccess => {
    const storeIds = byId.get(id);
    return storeIds ? { all: false, storeIds } : ALL_STORES;
  };
}

/** The company's pending invitations that have not expired, newest first. */
export async function listInvitations(tenantId: string): Promise<InvitationRow[]> {
  const rows = await db
    .select({
      id: invitation.id,
      email: invitation.email,
      roleKey: invitation.role,
      roleName: companyRole.name,
      inviterName: user.name,
      expiresAt: invitation.expiresAt,
    })
    .from(invitation)
    .innerJoin(user, eq(user.id, invitation.inviterId))
    .leftJoin(companyRole, and(eq(companyRole.tenantId, invitation.organizationId), eq(companyRole.key, invitation.role)))
    .where(and(eq(invitation.organizationId, tenantId), eq(invitation.status, PENDING), gt(invitation.expiresAt, new Date())))
    .orderBy(desc(invitation.createdAt));
  const accessOf = await invitationStoreAccess(db, rows.map((row) => row.id));
  return rows.map((row) => ({ ...row, roleKey: row.roleKey ?? "", storeAccess: accessOf(row.id) }));
}

export type CreateInvitationResult =
  | { ok: true; id: string }
  | PlanLimitError
  | { ok: false; error: "noAccount" | "alreadyMember" | "limit" | "roleNotFound" | "escalation" | "storeNotFound" };

/**
 * Invites the account with `email` to the company with `roleKey` and store access. Inviting
 * the same email again refreshes its pending invitation (same link, new role, stores and expiry). An email without
 * an account is refused (`noAccount`): those are added with a temporary password instead.
 */
export async function createInvitation(
  tenantId: string,
  actor: TeamActor,
  plan: PlanKey,
  values: InvitationValues,
): Promise<CreateInvitationResult> {
  const email = values.email.toLowerCase();
  const access = toStoreAccess(values.access);
  return db.transaction(async (tx) => {
    await lockCompany(tx, tenantId);
    const grantable =
      (await checkGrantable(tx, tenantId, actor, values.roleKey)) ??
      (await checkAccessGrantable(tx, tenantId, actor.storeAccess, access));
    if (grantable) return { ok: false, error: grantable } as const;

    const [account] = await tx.select({ id: user.id }).from(user).where(eq(user.email, email)).limit(1);
    if (!account) return { ok: false, error: "noAccount" } as const;
    const [already] = await tx
      .select({ id: member.id })
      .from(member)
      .where(and(eq(member.organizationId, tenantId), eq(member.userId, account.id)));
    if (already) return { ok: false, error: "alreadyMember" } as const;

    const expiresAt = new Date(Date.now() + INVITATION_DAYS * 24 * 60 * 60 * 1000);
    const pending = and(eq(invitation.organizationId, tenantId), eq(invitation.status, PENDING));
    const [existing] = await tx.select({ id: invitation.id }).from(invitation).where(and(pending, eq(invitation.email, email)));
    if (existing) {
      await tx
        .update(invitation)
        .set({ role: values.roleKey, expiresAt, inviterId: actor.userId })
        .where(eq(invitation.id, existing.id));
      await saveInvitationAccess(tx, tenantId, existing.id, access);
      return { ok: true, id: existing.id } as const;
    }
    const [{ total }] = await tx
      .select({ total: count() })
      .from(invitation)
      .where(and(pending, gt(invitation.expiresAt, new Date())));
    if (total >= MAX_PENDING_INVITATIONS) return { ok: false, error: "limit" } as const;
    const room = await checkMemberRoom(tx, tenantId, plan, { exceptEmail: email });
    if (room) return room;
    const [created] = await tx
      .insert(invitation)
      .values({ organizationId: tenantId, email, role: values.roleKey, status: PENDING, expiresAt, inviterId: actor.userId })
      .returning({ id: invitation.id });
    await saveInvitationAccess(tx, tenantId, created.id, access);
    return { ok: true, id: created.id } as const;
  });
}

async function saveInvitationAccess(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], tenantId: string, invitationId: string, access: StoreAccess) {
  const storeIds = access.all ? null : access.storeIds;
  await tx
    .insert(invitationAccess)
    .values({ invitationId, tenantId, storeIds })
    .onConflictDoUpdate({ target: invitationAccess.invitationId, set: { storeIds } });
}

/** Withdraws a pending invitation of the company (its link stops working). */
export async function cancelInvitation(tenantId: string, id: string): Promise<boolean> {
  const updated = await db
    .update(invitation)
    .set({ status: "canceled" })
    .where(and(eq(invitation.organizationId, tenantId), eq(invitation.id, id), eq(invitation.status, PENDING)))
    .returning({ id: invitation.id });
  return updated.length > 0;
}

export type InvitationView =
  | { state: "notFound" }
  | { state: "wrongEmail"; email: string }
  | { state: "closed" }
  | { state: "alreadyMember"; tenantId: string; companyName: string }
  | { state: "open"; companyName: string; roleName: string; inviterName: string; expiresAt: Date };

/**
 * What the invite page shows to the signed-in `viewer`. Another account's invitation only
 * reveals which email it is for (so the person knows which account to sign in with).
 */
export async function viewInvitation(id: string, viewer: { id: string; email: string }): Promise<InvitationView> {
  const [row] = await db
    .select({
      tenantId: invitation.organizationId,
      email: invitation.email,
      roleKey: invitation.role,
      status: invitation.status,
      expiresAt: invitation.expiresAt,
      companyName: organization.name,
      roleName: companyRole.name,
      inviterName: user.name,
    })
    .from(invitation)
    .innerJoin(organization, eq(organization.id, invitation.organizationId))
    .innerJoin(user, eq(user.id, invitation.inviterId))
    .leftJoin(companyRole, and(eq(companyRole.tenantId, invitation.organizationId), eq(companyRole.key, invitation.role)))
    .where(eq(invitation.id, id));
  if (!row) return { state: "notFound" };
  if (row.email !== viewer.email.toLowerCase()) return { state: "wrongEmail", email: row.email };
  const [membership] = await db
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.organizationId, row.tenantId), eq(member.userId, viewer.id)));
  if (membership) return { state: "alreadyMember", tenantId: row.tenantId, companyName: row.companyName };
  if (row.status !== PENDING || row.expiresAt <= new Date() || !row.roleName) return { state: "closed" };
  return { state: "open", companyName: row.companyName, roleName: row.roleName, inviterName: row.inviterName, expiresAt: row.expiresAt };
}

export type RespondResult =
  | { ok: true; tenantId: string }
  | { ok: false; error: "notFound" | "closed" | "alreadyMember" | "teamFull" };

/**
 * Accepts (or declines) an invitation as the signed-in `viewer`. Accepting re-checks
 * everything under the company lock: still pending and in time, the viewer's own email,
 * not a member yet, the role still exists, and the inviter is still a member who could give
 * it (team:create and every permission of the role) and the stores (within their own store
 * access). Then the membership is created with that store access (stores deleted since the
 * invitation are left out; the access stays limited even if none is left).
 */
export async function respondToInvitation(
  id: string,
  viewer: { id: string; email: string },
  accept: boolean,
): Promise<RespondResult> {
  const [found] = await db.select({ tenantId: invitation.organizationId }).from(invitation).where(eq(invitation.id, id));
  if (!found) return { ok: false, error: "notFound" };
  const tenantId = found.tenantId;

  return db.transaction(async (tx) => {
    await lockCompany(tx, tenantId);
    const [row] = await tx.select().from(invitation).where(eq(invitation.id, id)).for("update");
    if (!row || row.email !== viewer.email.toLowerCase()) return { ok: false, error: "notFound" } as const;
    if (row.status !== PENDING || row.expiresAt <= new Date()) return { ok: false, error: "closed" } as const;
    if (!accept) {
      await tx.update(invitation).set({ status: "rejected" }).where(eq(invitation.id, id));
      return { ok: true, tenantId } as const;
    }

    const [already] = await tx
      .select({ id: member.id })
      .from(member)
      .where(and(eq(member.organizationId, tenantId), eq(member.userId, viewer.id)));
    if (already) return { ok: false, error: "alreadyMember" } as const;
    // The plan may have changed since the invitation was sent
    const { plan } = await getCompanySubscription(tenantId);
    if (await checkMemberRoom(tx, tenantId, plan, null)) return { ok: false, error: "teamFull" } as const;

    const [role] = await tx
      .select({ permissions: companyRole.permissions })
      .from(companyRole)
      .where(and(eq(companyRole.tenantId, tenantId), eq(companyRole.key, row.role ?? "")));
    const [inviter] = await tx
      .select({ id: member.id, role: member.role })
      .from(member)
      .where(and(eq(member.organizationId, tenantId), eq(member.userId, row.inviterId)));
    if (!role || !inviter) return { ok: false, error: "closed" } as const;
    const inviterPermissions = await memberPermissions(tenantId, inviter.role, tx);
    const grantable =
      hasPermissions(inviterPermissions, { team: ["create"] }) &&
      hasPermissions(inviterPermissions, normalizePermissions(role.permissions));
    if (!grantable) return { ok: false, error: "closed" } as const;

    const invited = (await invitationStoreAccess(tx, [id]))(id);
    const access: StoreAccess = invited.all
      ? ALL_STORES
      : {
          all: false,
          storeIds: invited.storeIds.length === 0 ? [] : (
            await tx
              .select({ id: store.id })
              .from(store)
              .where(and(eq(store.tenantId, tenantId), inArray(store.id, invited.storeIds)))
          ).map((s) => s.id),
        };
    const inviterAccess = await memberStoreAccess(tx, tenantId, inviter.id, inviter.role);
    if (!accessWithin(inviterAccess, access)) return { ok: false, error: "closed" } as const;

    const [created] = await tx
      .insert(member)
      .values({ organizationId: tenantId, userId: viewer.id, role: row.role!, createdAt: new Date() })
      .returning({ id: member.id });
    await setMemberStoreAccess(tx, tenantId, created.id, access);
    await tx.update(invitation).set({ status: "accepted" }).where(eq(invitation.id, id));
    return { ok: true, tenantId } as const;
  });
}
