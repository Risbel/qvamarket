import { and, asc, companyRole, count, db, eq, gt, invitation, member, ne, sql, user } from "@qvashop/db";
import { auth } from "@/lib/auth";
import { generateTemporaryPassword } from "@/lib/passwords";
import { OWNER_ROLE, hasPermissions, isOwner, normalizePermissions, type Permissions } from "@/lib/permissions";
import { belowLimit, planLimitError, type PlanKey, type PlanLimitError } from "@/lib/plans";
import { accessWithin, type StoreAccess } from "@/lib/store-access";
import { toStoreAccess, type TeamMemberValues } from "@/lib/validation/team";
import { lockCompany, memberPermissions, type Tx } from "./company-roles";
import { removeUser } from "./provisioning";
import { checkAccessGrantable, listMemberAccess, memberStoreAccess, setMemberStoreAccess } from "./store-access";

// The company's team (Team page). Every function takes the tenantId from getMerchantOrNull();
// `actor` is who is acting. Rules, all checked here (the page only hides buttons):
// - nobody acts on themselves or on an owner (the owner role is never given or taken here);
// - nobody acts on a member whose permissions exceed their own, nor gives a role that does;
// - only roles of this company can be given;
// - the same for stores: nobody acts on a member who can open a store they cannot (or all
//   stores when they cannot), nor gives access to such a store; only this company's stores.
// Membership writes lock the company's organization row, like role writes (company-roles.ts),
// so a role cannot be deleted while it is being given.

export type TeamActor = { userId: string; permissions: Permissions; storeAccess: StoreAccess };

export type TeamMemberRow = {
  id: string;
  userId: string;
  name: string;
  email: string;
  /** member.role: role keys, comma-separated */
  role: string;
  joinedAt: Date;
  mustChangePassword: boolean;
  /** also a member of another company (shown without saying which) */
  otherCompanies: boolean;
  /** used elsewhere too (another company, or a customer account of another company's store) */
  sharedAccount: boolean;
  /** which stores they can open (owners: all) */
  storeAccess: StoreAccess;
};

// Correlated checks on the outer `member` row (this query joins, so columns are qualified)
const inOtherCompany = sql<boolean>`exists (select 1 from "member" m2 where m2.user_id = ${member.userId} and m2.organization_id <> ${member.organizationId})`;
const customerElsewhere = sql<boolean>`exists (select 1 from "customer" c2 where c2.user_id = ${member.userId} and c2.tenant_id <> ${member.organizationId})`;

export async function listTeamMembers(tenantId: string): Promise<TeamMemberRow[]> {
  const rows = await db
    .select({
      id: member.id,
      userId: member.userId,
      name: user.name,
      email: user.email,
      role: member.role,
      joinedAt: member.createdAt,
      mustChangePassword: user.mustChangePassword,
      otherCompanies: inOtherCompany,
      sharedAccount: sql<boolean>`(${inOtherCompany} or ${customerElsewhere})`,
    })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(eq(member.organizationId, tenantId))
    .orderBy(asc(member.createdAt));
  const access = await listMemberAccess(db, tenantId, rows);
  return rows.map((row) => ({ ...row, storeAccess: access.get(row.id) ?? { all: true } }));
}

/** Members who are not owners (owners do not count towards the plan's team size). */
const notOwner = sql`not ('owner' = any(regexp_split_to_array(trim(${member.role}), 's*,s*')))`;

/**
 * Room in the plan for one more team member? Counts the members who are not owners and,
 * with `invitations`, the pending invitations (each may become a member; `exceptEmail`'s own
 * is left out, since refreshing it adds nobody). Run under the company lock.
 */
export async function checkMemberRoom(
  executor: typeof db | Tx,
  tenantId: string,
  plan: PlanKey,
  invitations: { exceptEmail: string | null } | null,
): Promise<PlanLimitError | null> {
  const [{ members }] = await executor
    .select({ members: count() })
    .from(member)
    .where(and(eq(member.organizationId, tenantId), notOwner));
  let pending = 0;
  if (invitations) {
    const [row] = await executor
      .select({ total: count() })
      .from(invitation)
      .where(
        and(
          eq(invitation.organizationId, tenantId),
          eq(invitation.status, "pending"),
          gt(invitation.expiresAt, new Date()),
          invitations.exceptEmail ? ne(invitation.email, invitations.exceptEmail) : undefined,
        ),
      );
    pending = row.total;
  }
  return belowLimit(plan, "members", members + pending) ? null : planLimitError(plan, "members");
}

export type RoleCheck = "roleNotFound" | "escalation" | null;

/** Can `actor` give the company role `roleKey`? (it exists, is not owner, grants nothing more) */
export async function checkGrantable(executor: typeof db | Tx, tenantId: string, actor: TeamActor, roleKey: string): Promise<RoleCheck> {
  if (roleKey === OWNER_ROLE) return "roleNotFound";
  const [role] = await executor
    .select({ permissions: companyRole.permissions })
    .from(companyRole)
    .where(and(eq(companyRole.tenantId, tenantId), eq(companyRole.key, roleKey)));
  if (!role) return "roleNotFound";
  return hasPermissions(actor.permissions, normalizePermissions(role.permissions)) ? null : "escalation";
}

type TargetError = "notFound" | "self" | "owner" | "escalation";

/** The member `memberId` of the company, if `actor` may act on them. */
type Target = { id: string; userId: string; role: string; email: string };

async function findTarget(
  executor: typeof db | Tx,
  tenantId: string,
  actor: TeamActor,
  memberId: string,
): Promise<{ error: TargetError } | { target: Target }> {
  const [target] = await executor
    .select({ id: member.id, userId: member.userId, role: member.role, email: user.email, platformRole: user.role })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(and(eq(member.organizationId, tenantId), eq(member.id, memberId)));
  // A superadmin account is never managed from a company's team page
  if (!target || target.platformRole === "admin") return { error: "notFound" };
  if (target.userId === actor.userId) return { error: "self" };
  if (isOwner(target.role)) return { error: "owner" };
  const permissions = await memberPermissions(tenantId, target.role, executor);
  if (!hasPermissions(actor.permissions, permissions)) return { error: "escalation" };
  const access = await memberStoreAccess(executor, tenantId, target.id, target.role);
  if (!accessWithin(actor.storeAccess, access)) return { error: "escalation" };
  return { target };
}

export type AddMemberResult =
  | { ok: true; email: string; temporaryPassword: string }
  | PlanLimitError
  | { ok: false; error: "emailTaken" | "roleNotFound" | "escalation" | "storeNotFound" };

/**
 * Creates the member's account (temporary password, must change it on first login) and adds
 * it to the company with `roleKey`. No email provider: the credentials are returned once, to
 * be handed over by the owner. An email that already has an account is refused: an existing
 * account (maybe a customer's) is never attached to a company without its owner's consent.
 * The account is created through Better Auth (no session is created, so the actor's own
 * session is untouched) and removed again if adding the member fails.
 */
export async function addTeamMember(
  tenantId: string,
  actor: TeamActor,
  plan: PlanKey,
  values: TeamMemberValues,
): Promise<AddMemberResult> {
  const access = toStoreAccess(values.access);
  const grantable =
    (await checkGrantable(db, tenantId, actor, values.roleKey)) ??
    (await checkAccessGrantable(db, tenantId, actor.storeAccess, access));
  if (grantable) return { ok: false, error: grantable };
  const room = await checkMemberRoom(db, tenantId, plan, { exceptEmail: values.email.toLowerCase() });
  if (room) return room;
  const [existing] = await db.select({ id: user.id }).from(user).where(eq(user.email, values.email)).limit(1);
  if (existing) return { ok: false, error: "emailTaken" };

  const temporaryPassword = generateTemporaryPassword();
  let userId: string | undefined;
  try {
    // Without headers this is a trusted server call (no admin session needed)
    const created = await auth.api.createUser({
      body: { email: values.email, password: temporaryPassword, name: values.name, role: "user" },
    });
    userId = created.user.id;
    await db.update(user).set({ mustChangePassword: true }).where(eq(user.id, userId));
    const newUserId = userId;
    const refused = await db.transaction(async (tx) => {
      await lockCompany(tx, tenantId);
      // The role (or a store) may have been deleted or changed since the first check
      const check =
        (await checkGrantable(tx, tenantId, actor, values.roleKey)) ??
        (await checkAccessGrantable(tx, tenantId, actor.storeAccess, access)) ??
        (await checkMemberRoom(tx, tenantId, plan, { exceptEmail: values.email.toLowerCase() }));
      if (check) return check;
      const [created] = await tx
        .insert(member)
        .values({ organizationId: tenantId, userId: newUserId, role: values.roleKey, createdAt: new Date() })
        .returning({ id: member.id });
      await setMemberStoreAccess(tx, tenantId, created.id, access);
      return null;
    });
    if (refused) {
      await removeUser(userId);
      return typeof refused === "string" ? { ok: false, error: refused } : refused;
    }
    return { ok: true, email: values.email, temporaryPassword };
  } catch (error) {
    if (userId) await removeUser(userId);
    // Another request created that account in the meantime
    const [taken] = await db.select({ id: user.id }).from(user).where(eq(user.email, values.email)).limit(1);
    if (taken) return { ok: false, error: "emailTaken" };
    throw error;
  }
}

export type MemberActionResult = { ok: true } | { ok: false; error: TargetError | "roleNotFound" | "storeNotFound" };

/** Gives a member another company role (replacing what they had). */
export async function changeMemberRole(tenantId: string, actor: TeamActor, memberId: string, roleKey: string): Promise<MemberActionResult> {
  return db.transaction(async (tx) => {
    await lockCompany(tx, tenantId);
    const found = await findTarget(tx, tenantId, actor, memberId);
    if ("error" in found) return { ok: false, error: found.error } as const;
    const check = await checkGrantable(tx, tenantId, actor, roleKey);
    if (check) return { ok: false, error: check } as const;
    await tx.update(member).set({ role: roleKey }).where(and(eq(member.organizationId, tenantId), eq(member.id, memberId)));
    return { ok: true } as const;
  });
}

/** Changes which stores a member can open. */
export async function changeMemberStores(tenantId: string, actor: TeamActor, memberId: string, access: StoreAccess): Promise<MemberActionResult> {
  return db.transaction(async (tx) => {
    await lockCompany(tx, tenantId);
    const found = await findTarget(tx, tenantId, actor, memberId);
    if ("error" in found) return { ok: false, error: found.error } as const;
    const check = await checkAccessGrantable(tx, tenantId, actor.storeAccess, access);
    if (check) return { ok: false, error: check } as const;
    await setMemberStoreAccess(tx, tenantId, memberId, access);
    return { ok: true } as const;
  });
}

export type ResetMemberPasswordResult =
  | { ok: true; email: string; temporaryPassword: string }
  | { ok: false; error: TargetError | "sharedAccount" };

/**
 * Is the account also used outside this company (a member of another company, or a customer
 * of another company's store)? Then this company must not set its password.
 */
async function isSharedAccount(userId: string, tenantId: string): Promise<boolean> {
  const { rows } = await db.execute<{ shared: boolean }>(sql`
    select exists (select 1 from "member" where user_id = ${userId} and organization_id <> ${tenantId})
        or exists (select 1 from "customer" where user_id = ${userId} and tenant_id <> ${tenantId}) as shared`);
  return rows[0]?.shared === true;
}

/**
 * Gives a member a new temporary password (MVP recovery: no email provider). Same order as
 * the superadmin's reset: the forced-change flag first, so a failure later never leaves the
 * member signed in with a password they do not know; their sessions are ended last.
 * Refused (`sharedAccount`) for an account also used outside this company.
 */
export async function resetMemberPassword(tenantId: string, actor: TeamActor, memberId: string): Promise<ResetMemberPasswordResult> {
  const found = await findTarget(db, tenantId, actor, memberId);
  if ("error" in found) return { ok: false, error: found.error };
  const { target } = found;
  // The account is the person's, not the company's, once it is used elsewhere: setting its
  // password would hand this company the person's access to other companies and stores
  if (await isSharedAccount(target.userId, tenantId)) return { ok: false, error: "sharedAccount" };

  const temporaryPassword = generateTemporaryPassword();
  const context = await auth.$context;
  await db.update(user).set({ mustChangePassword: true }).where(eq(user.id, target.userId));
  await context.internalAdapter.updatePassword(target.userId, await context.password.hash(temporaryPassword));
  await context.internalAdapter.deleteUserSessions(target.userId);
  return { ok: true, email: target.email, temporaryPassword };
}

/**
 * Removes a member from the company. The account stays: order history and payment records
 * keep pointing at it (who did what), and it may be used in other companies or for shopping.
 * To add the person again, invite the account (an invitation, not a new account).
 */
export async function removeTeamMember(tenantId: string, actor: TeamActor, memberId: string): Promise<MemberActionResult> {
  const removed = await db.transaction(async (tx): Promise<{ error: TargetError } | { userId: string }> => {
    await lockCompany(tx, tenantId);
    const found = await findTarget(tx, tenantId, actor, memberId);
    if ("error" in found) return { error: found.error };
    await tx.delete(member).where(and(eq(member.organizationId, tenantId), eq(member.id, memberId)));
    return { userId: found.target.userId };
  });
  // No session is ended: membership is checked on every request, so the panel of this company
  // closes at once, while the person stays signed in for their other companies and stores
  return "error" in removed ? { ok: false, error: removed.error } : { ok: true };
}
