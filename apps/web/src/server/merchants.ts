import { db, eq, store, user } from "@qvashop/db";
import { auth } from "@/lib/auth";
import type { MerchantValues } from "@/lib/validation/merchant";
import { generateTemporaryPassword } from "@/lib/passwords";
import { getAdminSession } from "./admin";
import {
  createCompanyAndStore,
  findUnavailable,
  removeUser,
  type StoreStatus,
} from "./provisioning";

export type CreateMerchantResult =
  | { ok: true; tenantId: string; storeId: string; userId: string }
  | { ok: false; error: "forbidden" | "slugTaken" | "emailTaken" | "failed" };

/**
 * Superadmin creates a complete merchant: user (temporary password,
 * mustChangePassword) + company (organization, user is owner) + first store, already
 * ACTIVE (the superadmin vouches for it). `input` must already be validated with
 * createMerchantSchema. Self-registration is registerMerchant (store starts pending).
 *
 * Better Auth calls and the store insert cannot share one DB transaction, so on
 * failure the already-created rows are removed (compensation).
 */
export async function createMerchant(
  input: MerchantValues,
  requestHeaders: Headers,
): Promise<CreateMerchantResult> {
  if (!(await getAdminSession(requestHeaders))) {
    return { ok: false, error: "forbidden" };
  }

  const unavailable = await findUnavailable(input);
  if (unavailable) return { ok: false, error: unavailable };

  let userId: string | undefined;
  try {
    const created = await auth.api.createUser({
      body: {
        email: input.userEmail,
        password: input.temporaryPassword,
        name: input.userName,
        role: "user",
      },
      headers: requestHeaders,
    });
    userId = created.user.id;

    await db
      .update(user)
      .set({ mustChangePassword: true })
      .where(eq(user.id, userId));

    const { tenantId, storeId } = await createCompanyAndStore(userId, input, "active");
    return { ok: true, tenantId, storeId, userId };
  } catch (error) {
    console.error("createMerchant failed", error);
    if (userId) await removeUser(userId);
    return { ok: false, error: "failed" };
  }
}

export type ResetPasswordResult =
  | { ok: true; email: string; temporaryPassword: string }
  | { ok: false; error: "forbidden" | "notFound" | "failed" };

/**
 * Superadmin resets a merchant's password (MVP recovery path: no email provider).
 * Order matters: the forced-change flag goes first so that, if a later step fails,
 * the merchant is never left signed in with a password they do not know and no
 * forced change; the sessions are revoked last.
 */
export async function resetMerchantPassword(
  userId: string,
  requestHeaders: Headers,
): Promise<ResetPasswordResult> {
  if (!(await getAdminSession(requestHeaders))) {
    return { ok: false, error: "forbidden" };
  }

  const [target] = await db
    .select({ id: user.id, email: user.email, role: user.role })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  // Only merchants: never reset a superadmin's password through this path
  if (!target || target.role === "admin") {
    return { ok: false, error: "notFound" };
  }

  const temporaryPassword = generateTemporaryPassword();
  try {
    await db
      .update(user)
      .set({ mustChangePassword: true })
      .where(eq(user.id, target.id));
    await auth.api.setUserPassword({
      body: { userId: target.id, newPassword: temporaryPassword },
      headers: requestHeaders,
    });
    await auth.api.revokeUserSessions({
      body: { userId: target.id },
      headers: requestHeaders,
    });
    return { ok: true, email: target.email, temporaryPassword };
  } catch (error) {
    console.error("resetMerchantPassword failed", error);
    return { ok: false, error: "failed" };
  }
}

export type SetStoreStatusResult =
  | { ok: true }
  | { ok: false; error: "forbidden" | "notFound" | "failed" };

/**
 * Superadmin approves a pending store, suspends an active one or reactivates a suspended
 * one. Unscoped by tenant on purpose: the superadmin manages every company.
 */
export async function setStoreStatus(
  storeId: string,
  status: StoreStatus,
  requestHeaders: Headers,
): Promise<SetStoreStatusResult> {
  if (!(await getAdminSession(requestHeaders))) {
    return { ok: false, error: "forbidden" };
  }
  try {
    const rows = await db
      .update(store)
      .set({ status })
      .where(eq(store.id, storeId))
      .returning({ id: store.id });
    return rows.length === 1 ? { ok: true } : { ok: false, error: "notFound" };
  } catch (error) {
    console.error("setStoreStatus failed", error);
    return { ok: false, error: "failed" };
  }
}
