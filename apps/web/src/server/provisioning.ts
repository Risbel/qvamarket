import { db, eq, organization, store, storeCurrency, user } from "@qvashop/db";
import { auth } from "@/lib/auth";

// Building blocks shared by the two ways a merchant comes to exist: created by the
// superadmin (createMerchant) or registering themselves (registerMerchant).

export type StoreStatus = "pending" | "active" | "suspended";

export type NewCompanyInput = {
  companyName: string;
  storeName: string;
  storeSlug: string;
};

/** Is the subdomain or the email already taken? (null = both free) */
export async function findUnavailable(input: {
  storeSlug: string;
  userEmail: string;
}): Promise<"slugTaken" | "emailTaken" | null> {
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
  if (slugRow || orgRow) return "slugTaken";

  const [emailRow] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, input.userEmail))
    .limit(1);
  return emailRow ? "emailTaken" : null;
}

/**
 * Creates the company (organization, `userId` becomes its owner: passing userId is a
 * server-side-only option) and its first store with the given status. If the store cannot
 * be created the company is removed again and the error is rethrown; removing the user is
 * up to the caller, who created it.
 */
export async function createCompanyAndStore(
  userId: string,
  input: NewCompanyInput,
  status: StoreStatus,
  /** first (default) currency; the merchant can add more or change it in Settings */
  currencyCode = "USD",
) {
  const company = await auth.api.createOrganization({
    body: { name: input.companyName, slug: input.storeSlug, userId },
  });

  try {
    const [created] = await db
      .insert(store)
      .values({
        tenantId: company.id,
        slug: input.storeSlug,
        name: input.storeName,
        status,
      })
      .returning({ id: store.id });
    await db.insert(storeCurrency).values({
      storeId: created.id,
      tenantId: company.id,
      currencyCode,
      isDefault: true,
    });
    return { tenantId: company.id, storeId: created.id };
  } catch (error) {
    await db.delete(organization).where(eq(organization.id, company.id));
    throw error;
  }
}

/** Removes a user created during a failed provisioning (sessions and accounts cascade). */
export async function removeUser(userId: string) {
  await db.delete(user).where(eq(user.id, userId));
}
