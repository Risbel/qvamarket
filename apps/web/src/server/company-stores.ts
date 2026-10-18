import { count, db, eq, store } from "@qvashop/db";
import { MAX_STORES_PER_COMPANY } from "@/lib/stores";
import type { NewStoreValues } from "@/lib/validation/store";
import { lockCompany } from "./company-roles";
import { insertStore, isSlugTaken } from "./provisioning";

// A company's stores (company panel). The tenantId comes from getCompanyOrNull() and the
// caller must already have checked that the member is an owner.

export type CreateStoreResult = { ok: true; storeId: string } | { ok: false; error: "slugTaken" | "limit" };

/**
 * Creates a store in the company, `pending` until the superadmin approves it (like signup).
 * The company row is locked, so the store limit holds under concurrent requests; the
 * subdomain's unique constraint is the final word on `slugTaken`.
 */
export async function createCompanyStore(tenantId: string, values: NewStoreValues): Promise<CreateStoreResult> {
  try {
    return await db.transaction(async (tx) => {
      await lockCompany(tx, tenantId);
      const [{ total }] = await tx.select({ total: count() }).from(store).where(eq(store.tenantId, tenantId));
      if (total >= MAX_STORES_PER_COMPANY) return { ok: false, error: "limit" } as const;
      const storeId = await insertStore(tx, tenantId, values, "pending");
      return { ok: true, storeId } as const;
    });
  } catch (error) {
    if (isSlugTaken(error)) return { ok: false, error: "slugTaken" };
    throw error;
  }
}
