import { randomUUID } from "node:crypto";
import { and, asc, count, db, eq, inArray, product, productImage, productUpload, sql, store } from "@qvashop/db";
import { checkImageBytes, extensionFor, MAX_IMAGES_PER_PRODUCT, type ImageCheck } from "@/lib/images";
import type { ImageRef } from "@/lib/validation/product";
import { deleteObject, putObject, tenantKey } from "./storage";

// Product images: rows in `product_image` + files in object storage under
// tenants/<tenantId>/products/. Every function takes the tenant and store from
// requireMerchant()/getMerchantOrNull() and filters by them; ids come from the client but are
// only ever matched together with the tenant.
//
// Images are saved with the product form, in two steps: picking a file uploads it right away
// as a *staged upload* (`product_upload`: a file in storage, not attached to anything), and
// saving the form attaches the staged uploads, removes the images left out and sets the order
// (`applyProductImages`, inside the product's transaction). Leaving the form without saving
// changes nothing; staged uploads nobody saved are swept after a day.

type Scope = { tenantId: string; storeId: string };
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type ImageError = Extract<ImageCheck, { ok: false }>["error"] | "limit";

/** Staged uploads a store may hold at once (unsaved forms), so storage cannot be filled. */
export const MAX_PENDING_UPLOADS = 30;

/** Images of a product, main image (position 0) first. Empty when the product is not in scope. */
export async function listProductImages({ tenantId, storeId }: Scope, productId: string) {
  return db
    .select({
      id: productImage.id,
      storageKey: productImage.storageKey,
      position: productImage.position,
      altText: productImage.altText,
      sizeBytes: productImage.sizeBytes,
    })
    .from(productImage)
    .innerJoin(
      product,
      and(eq(product.id, productImage.productId), eq(product.tenantId, productImage.tenantId)),
    )
    .where(
      and(
        eq(productImage.tenantId, tenantId),
        eq(productImage.productId, productId),
        eq(product.storeId, storeId),
      ),
    )
    .orderBy(asc(productImage.position));
}

async function deleteFiles(keys: string[], context: string) {
  await Promise.all(
    keys.map((key) =>
      deleteObject(key).catch((error) => console.error(`${context}: could not delete file`, key, error)),
    ),
  );
}

/** Removes this store's staged uploads older than a day: never saved (rows first, then files). */
async function sweepStaleUploads({ tenantId, storeId }: Scope) {
  const rows = await db
    .delete(productUpload)
    .where(
      and(
        eq(productUpload.tenantId, tenantId),
        eq(productUpload.storeId, storeId),
        sql`${productUpload.createdAt} < now() - interval '1 day'`,
      ),
    )
    .returning({ key: productUpload.storageKey });
  await deleteFiles(rows.map((row) => row.key), "sweepStaleUploads");
}

/**
 * Validates the bytes (size, real type), uploads the file and records it as a staged upload
 * of the store. The file goes first, so a row never points at a missing file; if recording
 * fails the file is removed again.
 */
export async function stageProductImage(
  scope: Scope,
  userId: string,
  bytes: Uint8Array,
): Promise<{ ok: true; id: string; storageKey: string } | { ok: false; error: ImageError }> {
  const check = checkImageBytes(bytes);
  if (!check.ok) return check;

  await sweepStaleUploads(scope);

  const key = tenantKey(scope.tenantId, "products", `${randomUUID()}.${extensionFor(check.type)}`);
  await putObject({ key, body: bytes, contentType: check.type });

  try {
    const result = await db.transaction(async (tx) => {
      // Lock the store row so simultaneous uploads cannot both pass the limit
      await tx
        .select({ id: store.id })
        .from(store)
        .where(and(eq(store.id, scope.storeId), eq(store.tenantId, scope.tenantId)))
        .for("no key update");
      const [pending] = await tx
        .select({ total: count() })
        .from(productUpload)
        .where(and(eq(productUpload.tenantId, scope.tenantId), eq(productUpload.storeId, scope.storeId)));
      if (pending.total >= MAX_PENDING_UPLOADS) return { ok: false, error: "limit" } as const;

      const [row] = await tx
        .insert(productUpload)
        .values({
          tenantId: scope.tenantId,
          storeId: scope.storeId,
          userId,
          storageKey: key,
          contentType: check.type,
          sizeBytes: bytes.length,
        })
        .returning({ id: productUpload.id });
      return { ok: true, id: row.id, storageKey: key } as const;
    });

    if (!result.ok) await deleteObject(key).catch(() => {});
    return result;
  } catch (error) {
    await deleteObject(key).catch(() => {});
    throw error;
  }
}

/** Removes a staged upload the merchant took out of the form before saving. */
export async function discardProductUpload({ tenantId, storeId }: Scope, uploadId: string) {
  const rows = await db
    .delete(productUpload)
    .where(
      and(eq(productUpload.id, uploadId), eq(productUpload.tenantId, tenantId), eq(productUpload.storeId, storeId)),
    )
    .returning({ key: productUpload.storageKey });
  await deleteFiles(rows.map((row) => row.key), "discardProductUpload");
}

/**
 * Makes the product's images exactly `refs`, in that order (the first one is the main image):
 * attaches the staged uploads, removes the images left out and rewrites the positions. Runs
 * inside the product's save transaction, after the product row was inserted or locked.
 * `stale`: an id is not one of this product's images or this store's staged uploads (another
 * save changed them, or the upload was swept). Returns the files to delete after the commit.
 */
export async function applyProductImages(
  tx: Tx,
  { tenantId, storeId }: Scope,
  productId: string,
  refs: ImageRef[],
  /** the plan's images per product: more are refused, but a product already above it keeps them */
  planMax: number = MAX_IMAGES_PER_PRODUCT,
): Promise<{ ok: true; removedKeys: string[] } | { ok: false; error: "stale" | "limit" | "planLimit" }> {
  if (refs.length > MAX_IMAGES_PER_PRODUCT) return { ok: false, error: "limit" };

  const current = await tx
    .select({ id: productImage.id, storageKey: productImage.storageKey })
    .from(productImage)
    .where(and(eq(productImage.tenantId, tenantId), eq(productImage.productId, productId)));
  if (refs.length > planMax && refs.length > current.length) return { ok: false, error: "planLimit" };
  const uploadIds = refs.filter((ref) => ref.kind === "upload").map((ref) => ref.id);
  const uploads =
    uploadIds.length === 0
      ? []
      : await tx
          .select({
            id: productUpload.id,
            storageKey: productUpload.storageKey,
            contentType: productUpload.contentType,
            sizeBytes: productUpload.sizeBytes,
          })
          .from(productUpload)
          .where(
            and(
              eq(productUpload.tenantId, tenantId),
              eq(productUpload.storeId, storeId),
              inArray(productUpload.id, uploadIds),
            ),
          )
          .for("update");

  const currentIds = new Set(current.map((image) => image.id));
  const uploadsById = new Map(uploads.map((upload) => [upload.id, upload]));
  const known = refs.every((ref) => (ref.kind === "existing" ? currentIds.has(ref.id) : uploadsById.has(ref.id)));
  if (!known) return { ok: false, error: "stale" };

  const kept = new Set(refs.filter((ref) => ref.kind === "existing").map((ref) => ref.id));
  const removed = current.filter((image) => !kept.has(image.id));
  if (removed.length > 0) {
    await tx.delete(productImage).where(
      and(
        eq(productImage.tenantId, tenantId),
        inArray(
          productImage.id,
          removed.map((image) => image.id),
        ),
      ),
    );
  }

  for (const [position, ref] of refs.entries()) {
    if (ref.kind === "existing") {
      await tx
        .update(productImage)
        .set({ position })
        .where(and(eq(productImage.id, ref.id), eq(productImage.tenantId, tenantId)));
      continue;
    }
    // The row moves to product_image; the file stays where it was uploaded (same key)
    const upload = uploadsById.get(ref.id)!;
    await tx.delete(productUpload).where(and(eq(productUpload.id, upload.id), eq(productUpload.tenantId, tenantId)));
    await tx.insert(productImage).values({
      tenantId,
      productId,
      storageKey: upload.storageKey,
      contentType: upload.contentType,
      sizeBytes: upload.sizeBytes,
      position,
    });
  }

  return { ok: true, removedKeys: removed.map((image) => image.storageKey) };
}

/** Files of images a committed save removed (after the rows: never a row without a file). */
export const deleteRemovedImageFiles = (keys: string[]) => deleteFiles(keys, "applyProductImages");

/** Main image key per product (for list thumbnails): a map productId -> storage key. */
export async function mainImageKeys({ tenantId, storeId }: Scope, productIds: string[]) {
  if (productIds.length === 0) return new Map<string, string>();
  const rows = await db
    .select({ productId: productImage.productId, key: productImage.storageKey })
    .from(productImage)
    .innerJoin(
      product,
      and(eq(product.id, productImage.productId), eq(product.tenantId, productImage.tenantId)),
    )
    .where(
      and(
        eq(productImage.tenantId, tenantId),
        eq(product.storeId, storeId),
        eq(productImage.position, 0),
      ),
    );
  const wanted = new Set(productIds);
  return new Map(rows.filter((r) => wanted.has(r.productId)).map((r) => [r.productId, r.key]));
}
