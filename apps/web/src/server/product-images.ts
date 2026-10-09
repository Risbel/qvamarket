import { randomUUID } from "node:crypto";
import { and, asc, count, db, eq, product, productImage, sql } from "@qvashop/db";
import {
  checkImageBytes,
  extensionFor,
  MAX_IMAGES_PER_PRODUCT,
  type ImageCheck,
} from "@/lib/images";
import { deleteObject, putObject, tenantKey } from "./storage";

// Product images: rows in `product_image` + files in object storage under
// tenants/<tenantId>/products/<productId>/. Every function takes the tenant and store
// from requireMerchant()/getMerchantOrNull() and filters by them; ids come from the
// client but are only ever matched together with the tenant.

type Scope = { tenantId: string; storeId: string };
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type ImageError =
  | Extract<ImageCheck, { ok: false }>["error"]
  | "notFound"
  | "limit";

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

async function productInScope({ tenantId, storeId }: Scope, productId: string) {
  const [row] = await db
    .select({ id: product.id })
    .from(product)
    .where(
      and(eq(product.id, productId), eq(product.tenantId, tenantId), eq(product.storeId, storeId)),
    )
    .limit(1);
  return Boolean(row);
}

async function imageCount(tenantId: string, productId: string) {
  const [row] = await db
    .select({ total: count() })
    .from(productImage)
    .where(and(eq(productImage.tenantId, tenantId), eq(productImage.productId, productId)));
  return row.total;
}

/**
 * Validates the bytes (size, real type), uploads the file and then records it as the
 * product's last image. The file goes first, so a row never points at a missing file;
 * if recording fails the file is removed again.
 */
export async function addProductImage(
  scope: Scope,
  productId: string,
  bytes: Uint8Array,
): Promise<{ ok: true; id: string } | { ok: false; error: ImageError }> {
  const check = checkImageBytes(bytes);
  if (!check.ok) return check;

  if (!(await productInScope(scope, productId))) return { ok: false, error: "notFound" };
  // Cheap early exit; the authoritative check runs again under the row lock below
  if ((await imageCount(scope.tenantId, productId)) >= MAX_IMAGES_PER_PRODUCT) {
    return { ok: false, error: "limit" };
  }

  const key = tenantKey(
    scope.tenantId,
    "products",
    productId,
    `${randomUUID()}.${extensionFor(check.type)}`,
  );
  await putObject({ key, body: bytes, contentType: check.type });

  try {
    const result = await db.transaction(async (tx) => {
      // Lock the product row so two simultaneous uploads cannot both pass the limit
      const [locked] = await tx
        .select({ id: product.id })
        .from(product)
        .where(
          and(
            eq(product.id, productId),
            eq(product.tenantId, scope.tenantId),
            eq(product.storeId, scope.storeId),
          ),
        )
        .for("update")
        .limit(1);
      if (!locked) return { ok: false, error: "notFound" } as const;

      const [stats] = await tx
        .select({
          total: count(),
          next: sql<number>`coalesce(max(${productImage.position}) + 1, 0)`,
        })
        .from(productImage)
        .where(
          and(eq(productImage.tenantId, scope.tenantId), eq(productImage.productId, productId)),
        );
      if (stats.total >= MAX_IMAGES_PER_PRODUCT) return { ok: false, error: "limit" } as const;

      const [row] = await tx
        .insert(productImage)
        .values({
          tenantId: scope.tenantId,
          productId,
          storageKey: key,
          contentType: check.type,
          sizeBytes: bytes.length,
          position: Number(stats.next),
        })
        .returning({ id: productImage.id });
      return { ok: true, id: row.id } as const;
    });

    if (!result.ok) await deleteObject(key).catch(() => {});
    return result;
  } catch (error) {
    await deleteObject(key).catch(() => {});
    throw error;
  }
}

/** Rewrites positions as 0..n-1 following `orderedIds` (the first one is the main image). */
async function setPositions(tx: Tx, tenantId: string, orderedIds: string[]) {
  for (const [position, id] of orderedIds.entries()) {
    await tx
      .update(productImage)
      .set({ position })
      .where(and(eq(productImage.id, id), eq(productImage.tenantId, tenantId)));
  }
}

async function findImage({ tenantId, storeId }: Scope, imageId: string) {
  const [row] = await db
    .select({
      id: productImage.id,
      productId: productImage.productId,
      storageKey: productImage.storageKey,
    })
    .from(productImage)
    .innerJoin(
      product,
      and(eq(product.id, productImage.productId), eq(product.tenantId, productImage.tenantId)),
    )
    .where(
      and(
        eq(productImage.id, imageId),
        eq(productImage.tenantId, tenantId),
        eq(product.storeId, storeId),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Removes the row (the next image becomes the main one) and then the file. */
export async function deleteProductImage(
  scope: Scope,
  imageId: string,
): Promise<{ ok: true } | { ok: false; error: "notFound" }> {
  const image = await findImage(scope, imageId);
  if (!image) return { ok: false, error: "notFound" };

  await db.transaction(async (tx) => {
    await tx
      .delete(productImage)
      .where(and(eq(productImage.id, image.id), eq(productImage.tenantId, scope.tenantId)));
    const rest = await tx
      .select({ id: productImage.id })
      .from(productImage)
      .where(
        and(
          eq(productImage.tenantId, scope.tenantId),
          eq(productImage.productId, image.productId),
        ),
      )
      .orderBy(asc(productImage.position));
    await setPositions(tx, scope.tenantId, rest.map((r) => r.id));
  });

  // After the rows: a storage failure leaves an orphan file, never a row without a file
  await deleteObject(image.storageKey).catch((error) =>
    console.error("deleteProductImage: could not delete file", image.storageKey, error),
  );
  return { ok: true };
}

/** Makes this image the main one (position 0); the others keep their relative order. */
export async function setMainProductImage(
  scope: Scope,
  imageId: string,
): Promise<{ ok: true } | { ok: false; error: "notFound" }> {
  const image = await findImage(scope, imageId);
  if (!image) return { ok: false, error: "notFound" };

  await db.transaction(async (tx) => {
    const all = await tx
      .select({ id: productImage.id })
      .from(productImage)
      .where(
        and(
          eq(productImage.tenantId, scope.tenantId),
          eq(productImage.productId, image.productId),
        ),
      )
      .orderBy(asc(productImage.position));
    const ordered = [image.id, ...all.map((r) => r.id).filter((id) => id !== image.id)];
    await setPositions(tx, scope.tenantId, ordered);
  });
  return { ok: true };
}

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
