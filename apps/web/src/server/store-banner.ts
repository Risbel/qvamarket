import { randomUUID } from "node:crypto";
import { and, asc, count, db, eq, sql, store, storeBannerImage } from "@qvashop/db";
import { checkImageBytes, extensionFor, MAX_BANNER_IMAGES, type ImageCheck } from "@/lib/images";
import { deleteObject, putObject, tenantKey } from "./storage";

// Hero banner images: rows in `store_banner_image` + files in object storage under
// tenants/<tenantId>/stores/<storeId>/banner/. Every function takes the tenant and store
// from getMerchantOrNull()/requireMerchant() and filters by both; image ids come from the
// client but are only ever matched together with them.

type Scope = { tenantId: string; storeId: string };
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type BannerError = Extract<ImageCheck, { ok: false }>["error"] | "notFound" | "limit";

const inScope = ({ tenantId, storeId }: Scope) =>
  and(eq(storeBannerImage.tenantId, tenantId), eq(storeBannerImage.storeId, storeId));

/** Banner images in display order. */
export async function listBannerImages(scope: Scope) {
  return db
    .select({
      id: storeBannerImage.id,
      storageKey: storeBannerImage.storageKey,
      sizeBytes: storeBannerImage.sizeBytes,
    })
    .from(storeBannerImage)
    .where(inScope(scope))
    .orderBy(asc(storeBannerImage.position), asc(storeBannerImage.createdAt));
}

/** Rewrites positions as 0..n-1 following `orderedIds`. */
async function setPositions(tx: Tx, scope: Scope, orderedIds: string[]) {
  for (const [position, id] of orderedIds.entries()) {
    await tx
      .update(storeBannerImage)
      .set({ position })
      .where(and(inScope(scope), eq(storeBannerImage.id, id)));
  }
}

/** Locks the store row: serializes uploads (limit) and reorders of the same store. */
async function lockStore(tx: Tx, { tenantId, storeId }: Scope) {
  const [row] = await tx
    .select({ id: store.id })
    .from(store)
    .where(and(eq(store.id, storeId), eq(store.tenantId, tenantId)))
    .for("no key update")
    .limit(1);
  return Boolean(row);
}

/**
 * Validates the bytes (size, real type), uploads the file and then records it as the last
 * banner image. The file goes first, so a row never points at a missing file; if recording
 * fails or is refused the file is removed again.
 */
export async function addBannerImage(
  scope: Scope,
  bytes: Uint8Array,
): Promise<{ ok: true; id: string } | { ok: false; error: BannerError }> {
  const check = checkImageBytes(bytes);
  if (!check.ok) return check;

  // Cheap early exit; the authoritative check runs again under the store lock below
  const [existing] = await db.select({ total: count() }).from(storeBannerImage).where(inScope(scope));
  if (existing.total >= MAX_BANNER_IMAGES) return { ok: false, error: "limit" };

  const key = tenantKey(
    scope.tenantId,
    "stores",
    scope.storeId,
    "banner",
    `${randomUUID()}.${extensionFor(check.type)}`,
  );
  await putObject({ key, body: bytes, contentType: check.type });

  try {
    const result = await db.transaction(async (tx) => {
      if (!(await lockStore(tx, scope))) return { ok: false, error: "notFound" } as const;

      const [stats] = await tx
        .select({
          total: count(),
          next: sql<number>`coalesce(max(${storeBannerImage.position}) + 1, 0)`,
        })
        .from(storeBannerImage)
        .where(inScope(scope));
      if (stats.total >= MAX_BANNER_IMAGES) return { ok: false, error: "limit" } as const;

      const [row] = await tx
        .insert(storeBannerImage)
        .values({
          tenantId: scope.tenantId,
          storeId: scope.storeId,
          storageKey: key,
          contentType: check.type,
          sizeBytes: bytes.length,
          position: Number(stats.next),
        })
        .returning({ id: storeBannerImage.id });
      return { ok: true, id: row.id } as const;
    });

    if (!result.ok) await deleteObject(key).catch(() => {});
    return result;
  } catch (error) {
    await deleteObject(key).catch(() => {});
    throw error;
  }
}

/** Removes the row (the rest close the gap) and then the file. */
export async function deleteBannerImage(
  scope: Scope,
  imageId: string,
): Promise<{ ok: true } | { ok: false; error: "notFound" }> {
  const removed = await db.transaction(async (tx) => {
    if (!(await lockStore(tx, scope))) return null;
    const [row] = await tx
      .delete(storeBannerImage)
      .where(and(inScope(scope), eq(storeBannerImage.id, imageId)))
      .returning({ storageKey: storeBannerImage.storageKey });
    if (!row) return null;
    const rest = await tx
      .select({ id: storeBannerImage.id })
      .from(storeBannerImage)
      .where(inScope(scope))
      .orderBy(asc(storeBannerImage.position), asc(storeBannerImage.createdAt));
    await setPositions(tx, scope, rest.map((r) => r.id));
    return row;
  });
  if (!removed) return { ok: false, error: "notFound" };

  // After the rows: a storage failure leaves an orphan file, never a row without a file
  await deleteObject(removed.storageKey).catch((error) =>
    console.error("deleteBannerImage: could not delete file", removed.storageKey, error),
  );
  return { ok: true };
}

/** Swaps the image with its neighbour; positions are rewritten as 0..n-1. */
export async function moveBannerImage(
  scope: Scope,
  imageId: string,
  direction: "up" | "down",
): Promise<{ ok: true } | { ok: false; error: "notFound" }> {
  return db.transaction(async (tx) => {
    if (!(await lockStore(tx, scope))) return { ok: false, error: "notFound" } as const;
    const all = await tx
      .select({ id: storeBannerImage.id })
      .from(storeBannerImage)
      .where(inScope(scope))
      .orderBy(asc(storeBannerImage.position), asc(storeBannerImage.createdAt));
    const index = all.findIndex((row) => row.id === imageId);
    if (index < 0) return { ok: false, error: "notFound" } as const;
    const target = direction === "up" ? index - 1 : index + 1;
    if (target < 0 || target >= all.length) return { ok: true } as const;
    const ordered = all.map((row) => row.id);
    [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
    await setPositions(tx, scope, ordered);
    return { ok: true } as const;
  });
}
