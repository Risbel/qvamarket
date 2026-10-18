import {
  and,
  db,
  eq,
  invitationAccess,
  product,
  productImage,
  productUpload,
  sql,
  store,
  storeBannerImage,
  storeSecondaryBannerPair,
} from "@qvashop/db";
import { getAdminSession } from "./admin";
import { deleteObject, deleteObjectsWithPrefix } from "./storage";

// Hard delete of a store (decided 2026-10): only the superadmin, from the admin panel, after
// typing the store's subdomain. The database cascades every row of the store (catalog,
// prices, promotions, orders with their items / payments / history, settings, banners,
// pages, favorites of its products); the company, its members, roles and customers stay
// (they belong to the company, which may have other stores); members limited to this store
// lose it (and keep a limited access, possibly to no store at all). Files are deleted after the
// commit: a storage failure leaves orphan files, never rows pointing to nothing.

export type DeleteStoreResult =
  | { ok: true; name: string; files: number }
  | { ok: false; error: "forbidden" | "notFound" | "confirmation" | "failed" };

export async function deleteStore(
  storeId: string,
  confirmation: string,
  requestHeaders: Headers,
): Promise<DeleteStoreResult> {
  const admin = await getAdminSession(requestHeaders);
  if (!admin) return { ok: false, error: "forbidden" };

  let removed: { tenantId: string; name: string; slug: string; keys: string[] } | "notFound" | "confirmation";
  try {
    removed = await db.transaction(async (tx) => {
      // Locks the store: a concurrent upload or checkout waits, then finds it gone
      const [row] = await tx
        .select({ tenantId: store.tenantId, name: store.name, slug: store.slug, logoKey: store.logoKey, logotypeKey: store.logotypeKey })
        .from(store)
        .where(eq(store.id, storeId))
        .for("update");
      if (!row) return "notFound" as const;
      // Re-checked here: the browser's "type the subdomain" check is only UX
      if (confirmation.trim().toLowerCase() !== row.slug) return "confirmation" as const;

      const [images, uploads, banners, pairs] = await Promise.all([
        tx
          .select({ key: productImage.storageKey })
          .from(productImage)
          .innerJoin(product, and(eq(product.id, productImage.productId), eq(product.tenantId, productImage.tenantId)))
          .where(and(eq(product.storeId, storeId), eq(product.tenantId, row.tenantId))),
        tx.select({ key: productUpload.storageKey }).from(productUpload).where(eq(productUpload.storeId, storeId)),
        tx.select({ key: storeBannerImage.storageKey }).from(storeBannerImage).where(eq(storeBannerImage.storeId, storeId)),
        tx
          .select({ left: storeSecondaryBannerPair.leftStorageKey, right: storeSecondaryBannerPair.rightStorageKey })
          .from(storeSecondaryBannerPair)
          .where(eq(storeSecondaryBannerPair.storeId, storeId)),
      ]);
      const keys = [
        row.logoKey,
        row.logotypeKey,
        ...images.map((i) => i.key),
        ...uploads.map((u) => u.key),
        ...banners.map((b) => b.key),
        ...pairs.flatMap((p) => [p.left, p.right]),
      ].filter((key): key is string => Boolean(key));

      await tx.delete(store).where(eq(store.id, storeId));
      // member_store rows cascade; pending invitations hold the ids in an array
      await tx
        .update(invitationAccess)
        .set({ storeIds: sql`array_remove(${invitationAccess.storeIds}, ${storeId}::uuid)` })
        .where(and(eq(invitationAccess.tenantId, row.tenantId), sql`${storeId}::uuid = any(${invitationAccess.storeIds})`));
      return { tenantId: row.tenantId, name: row.name, slug: row.slug, keys };
    });
  } catch (error) {
    console.error("deleteStore failed", error);
    return { ok: false, error: "failed" };
  }
  if (removed === "notFound" || removed === "confirmation") return { ok: false, error: removed };

  // Product images live under tenants/<id>/products/ (shared by the company's stores), so they
  // go by key; the store's own folder (logo, banners) is also swept for leftovers.
  const results = await Promise.allSettled(removed.keys.map((key) => deleteObject(key)));
  results.forEach((result, index) => {
    if (result.status === "rejected") console.error("deleteStore: could not delete file", removed.keys[index], result.reason);
  });
  let swept = 0;
  try {
    swept = await deleteObjectsWithPrefix(`tenants/${removed.tenantId}/stores/${storeId}/`);
  } catch (error) {
    console.error("deleteStore: could not sweep the store folder", storeId, error);
  }
  console.info(`deleteStore: ${admin.user.email} deleted store ${removed.slug} (${storeId}) of tenant ${removed.tenantId}`);
  return { ok: true, name: removed.name, files: results.filter((r) => r.status === "fulfilled").length + swept };
}
