import { db, eq, organization, store, user } from "@qvashop/db";
import { auth } from "@/lib/auth";
import type { MerchantValues } from "@/lib/validation/merchant";
import { generateTemporaryPassword } from "@/lib/passwords";
import { getAdminSession } from "./admin";

export type CreateMerchantResult =
  | { ok: true; tenantId: string; storeId: string; userId: string }
  | { ok: false; error: "forbidden" | "slugTaken" | "emailTaken" | "failed" };

/**
 * Superadmin creates a complete merchant: user (temporary password,
 * mustChangePassword) + company (organization, user is owner) + first store.
 * `input` must already be validated with createMerchantSchema.
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

  const [slugRow] = await db
    .select({ id: store.id })
    .from(store)
    .where(eq(store.slug, input.storeSlug))
    .limit(1);
  const [orgRow] = await db
    .select({ id: organization.id })
    .from(organization)
    .where(eq(organization.slug, input.storeSlug))
    .limit(1);
  if (slugRow || orgRow) return { ok: false, error: "slugTaken" };

  const [emailRow] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, input.userEmail))
    .limit(1);
  if (emailRow) return { ok: false, error: "emailTaken" };

  let userId: string | undefined;
  let tenantId: string | undefined;
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

    // Company = organization. Passing userId (server-side only) makes the merchant its owner.
    const company = await auth.api.createOrganization({
      body: { name: input.companyName, slug: input.storeSlug, userId },
    });
    tenantId = company.id;

    const [createdStore] = await db
      .insert(store)
      .values({
        tenantId,
        slug: input.storeSlug,
        name: input.storeName,
      })
      .returning({ id: store.id });

    return { ok: true, tenantId, storeId: createdStore.id, userId };
  } catch (error) {
    console.error("createMerchant failed", error);
    // organization delete cascades to member and store; user delete cascades to account/session
    if (tenantId) {
      await db.delete(organization).where(eq(organization.id, tenantId));
    }
    if (userId) {
      await db.delete(user).where(eq(user.id, userId));
    }
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
