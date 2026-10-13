import { randomUUID } from "node:crypto";
import { and, asc, count, db, eq, sql, store, storeBannerImage } from "@qvashop/db";
import { checkImageBytes, extensionFor, MAX_BANNER_IMAGES, type BannerDevice, type ImageCheck } from "@/lib/images";
import { deleteObject, putObject, tenantKey } from "./storage";

// Hero banner images: rows in `store_banner_image` + files in object storage under
// tenants/<tenantId>/stores/<storeId>/banner/. Every function takes the tenant and store
// from getMerchantOrNull()/requireMerchant() and filters by both; image ids come from the
// client but are only ever matched together with them. Order and limit are per device
// (desktop and mobile are two independent lists).

type Scope = { tenantId: string; storeId: string };
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type BannerError = Extract<ImageCheck, { ok: false }>["error"] | "notFound" | "limit";

const inScope = ({ tenantId, storeId }: Scope) =>
  and(eq(storeBannerImage.tenantId, tenantId), eq(storeBannerImage.storeId, storeId));

const onDevice = (scope: Scope, device: BannerDevice) =>
  and(inScope(scope), eq(storeBannerImage.device, device));

/** Banner images of both devices, each list in display order. */
export async function listBannerImages(scope: Scope) {
  return db
    .select({
      id: storeBannerImage.id,
      device: storeBannerImage.device,
      storageKey: storeBannerImage.storageKey,
      sizeBytes: storeBannerImage.sizeBytes,
    })
    .from(storeBannerImage)
    .where(inScope(scope))
    .orderBy(asc(storeBannerImage.position), asc(storeBannerImage.createdAt));
}

/** The other images of the same device, in display order. */
async function deviceIds(tx: Tx, scope: Scope, device: BannerDevice) {
  const rows = await tx
    .select({ id: storeBannerImage.id })
    .from(storeBannerImage)
    .where(onDevice(scope, device))
    .orderBy(asc(storeBannerImage.position), asc(storeBannerImage.createdAt));
  return rows.map((row) => row.id);
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

/** Locks the store row: serializes uploads (limit), deletes and reorders of the same store. */
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
 * banner image of that device. The file goes first, so a row never points at a missing file; if recording
 * fails or is refused the file is removed again.
 */
export async function addBannerImage(
  scope: Scope,
  device: BannerDevice,
  bytes: Uint8Array,
): Promise<{ ok: true; id: string } | { ok: false; error: BannerError }> {
  const check = checkImageBytes(bytes);
  if (!check.ok) return check;

  // Cheap early exit; the authoritative check runs again under the store lock below
  const [existing] = await db.select({ total: count() }).from(storeBannerImage).where(onDevice(scope, device));
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
        .where(onDevice(scope, device));
      if (stats.total >= MAX_BANNER_IMAGES) return { ok: false, error: "limit" } as const;

      const [row] = await tx
        .insert(storeBannerImage)
        .values({
          tenantId: scope.tenantId,
          storeId: scope.storeId,
          device,
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

/** Removes the row (the rest of its device close the gap) and then the file. */
export async function deleteBannerImage(
  scope: Scope,
  imageId: string,
): Promise<{ ok: true } | { ok: false; error: "notFound" }> {
  const removed = await db.transaction(async (tx) => {
    if (!(await lockStore(tx, scope))) return null;
    const [row] = await tx
      .delete(storeBannerImage)
      .where(and(inScope(scope), eq(storeBannerImage.id, imageId)))
      .returning({ storageKey: storeBannerImage.storageKey, device: storeBannerImage.device });
    if (!row) return null;
    await setPositions(tx, scope, await deviceIds(tx, scope, row.device as BannerDevice));
    return row;
  });
  if (!removed) return { ok: false, error: "notFound" };

  // After the rows: a storage failure leaves an orphan file, never a row without a file
  await deleteObject(removed.storageKey).catch((error) =>
    console.error("deleteBannerImage: could not delete file", removed.storageKey, error),
  );
  return { ok: true };
}

/** Swaps the image with its neighbour on the same device; positions are rewritten as 0..n-1. */
export async function moveBannerImage(
  scope: Scope,
  imageId: string,
  direction: "up" | "down",
): Promise<{ ok: true } | { ok: false; error: "notFound" }> {
  return db.transaction(async (tx) => {
    if (!(await lockStore(tx, scope))) return { ok: false, error: "notFound" } as const;
    const [image] = await tx
      .select({ device: storeBannerImage.device })
      .from(storeBannerImage)
      .where(and(inScope(scope), eq(storeBannerImage.id, imageId)))
      .limit(1);
    if (!image) return { ok: false, error: "notFound" } as const;
    const ordered = await deviceIds(tx, scope, image.device as BannerDevice);
    const index = ordered.indexOf(imageId);
    const target = direction === "up" ? index - 1 : index + 1;
    if (target < 0 || target >= ordered.length) return { ok: true } as const;
    [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
    await setPositions(tx, scope, ordered);
    return { ok: true } as const;
  });
}
