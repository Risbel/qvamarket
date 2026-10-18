import { and, db, eq, impersonationLog, member, session as sessionTable, user } from "@qvashop/db";
import { auth } from "@/lib/auth";
import { getAdminSession } from "./admin";

export type StartImpersonationResult =
  | { ok: true }
  | { ok: false; error: "forbidden" | "notFound" | "failed" };

export type StopImpersonationResult =
  | { ok: true }
  | { ok: false; error: "notImpersonating" | "failed" };

function requestMeta(requestHeaders: Headers) {
  return {
    ipAddress:
      requestHeaders.get("cf-connecting-ip") ??
      requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      null,
    userAgent: requestHeaders.get("user-agent"),
  };
}

/**
 * Superadmin starts a session as a member of the company `tenantId` (any member, not only
 * its owner). Every impersonation is logged: the log row is written BEFORE the session is
 * created (so an impersonation can never exist without a record) and removed again if
 * creating the session fails. The new session opens that company (its active company), even
 * when the person also works in others. Admin accounts cannot be impersonated, and an
 * impersonated session is not an admin session, so impersonations cannot be nested.
 */
export async function startImpersonation(
  targetUserId: string,
  tenantId: string,
  requestHeaders: Headers,
): Promise<StartImpersonationResult> {
  const admin = await getAdminSession(requestHeaders);
  if (!admin) return { ok: false, error: "forbidden" };

  const [target] = await db
    .select({
      id: user.id,
      email: user.email,
      role: user.role,
      banned: user.banned,
    })
    .from(user)
    .where(eq(user.id, targetUserId))
    .limit(1);
  if (!target || target.role === "admin" || target.banned) {
    return { ok: false, error: "notFound" };
  }

  const [membership] = await db
    .select({ tenantId: member.organizationId })
    .from(member)
    .where(and(eq(member.userId, target.id), eq(member.organizationId, tenantId)))
    .limit(1);
  if (!membership) return { ok: false, error: "notFound" };

  let logId: string | undefined;
  try {
    const [row] = await db
      .insert(impersonationLog)
      .values({
        action: "start",
        adminUserId: admin.user.id,
        adminEmail: admin.user.email,
        targetUserId: target.id,
        targetEmail: target.email,
        tenantId: membership.tenantId,
        ...requestMeta(requestHeaders),
      })
      .returning({ id: impersonationLog.id });
    logId = row.id;

    const impersonated = await auth.api.impersonateUser({
      body: { userId: target.id },
      headers: requestHeaders,
    });
    // Open the chosen company (the person may work in several)
    await db
      .update(sessionTable)
      .set({ activeOrganizationId: membership.tenantId })
      .where(eq(sessionTable.token, impersonated.session.token));
    return { ok: true };
  } catch (error) {
    console.error("startImpersonation failed", error);
    if (logId) {
      await db.delete(impersonationLog).where(eq(impersonationLog.id, logId));
    }
    return { ok: false, error: "failed" };
  }
}

/** Ends an impersonation and restores the superadmin session; logs a "stop" row. */
export async function stopImpersonation(
  requestHeaders: Headers,
): Promise<StopImpersonationResult> {
  const session = await auth.api.getSession({ headers: requestHeaders });
  const adminUserId = session?.session.impersonatedBy;
  if (!session || !adminUserId) return { ok: false, error: "notImpersonating" };

  try {
    await auth.api.stopImpersonating({ headers: requestHeaders });
  } catch (error) {
    console.error("stopImpersonation failed", error);
    return { ok: false, error: "failed" };
  }

  // The session is already restored; a logging failure must not strand the admin
  try {
    const [admin] = await db
      .select({ email: user.email })
      .from(user)
      .where(eq(user.id, adminUserId))
      .limit(1);
    // The company the impersonated session was in (the one it started in, or switched to)
    const tenantId = session.session.activeOrganizationId ?? null;
    const [membership] = tenantId
      ? await db
          .select({ tenantId: member.organizationId })
          .from(member)
          .where(and(eq(member.userId, session.user.id), eq(member.organizationId, tenantId)))
          .limit(1)
      : [];
    await db.insert(impersonationLog).values({
      action: "stop",
      adminUserId,
      adminEmail: admin?.email ?? "unknown",
      targetUserId: session.user.id,
      targetEmail: session.user.email,
      tenantId: membership?.tenantId ?? null,
      ...requestMeta(requestHeaders),
    });
  } catch (error) {
    console.error("stopImpersonation: could not write the log row", error);
  }
  return { ok: true };
}
