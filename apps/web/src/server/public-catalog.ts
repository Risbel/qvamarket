import { and, asc, db, desc, eq, inArray, product, productImage, sql, store } from "@qvashop/db";

// Public catalog: what an anonymous visitor may see of a store's products.
//
// Like getPublicStoreBySlug this reads tenant data without a tenant filter coming from the
// caller (there is no signed-in tenant), so the safety is in the query itself:
//  - the product is joined to its store through (store_id, tenant_id), the same composite
//    key the database enforces, so it can only match its own store;
//  - only products with status "active" in a store with status "active" are returned;
//  - tenant_id never leaves this file.

const publicProducts = (storeId: string) =>
  and(
    eq(store.id, storeId),
    eq(store.status, "active"),
    eq(product.status, "active"),
  );

export type PublicProductSummary = {
  id: string;
  name: string;
  priceMinor: number;
  /** null = stock is not tracked (always available) */
  stock: number | null;
  imageKey: string | null;
};

export async function listPublicProducts(storeId: string): Promise<PublicProductSummary[]> {
  return db
    .select({
      id: product.id,
      name: product.name,
      priceMinor: product.priceMinor,
      stock: product.stock,
      // main image = position 0
      imageKey: sql<string | null>`(
        select pi.storage_key from product_image pi
        where pi.product_id = ${product.id} and pi.tenant_id = ${product.tenantId}
        order by pi.position asc limit 1
      )`,
    })
    .from(product)
    .innerJoin(store, and(eq(store.id, product.storeId), eq(store.tenantId, product.tenantId)))
    .where(publicProducts(storeId))
    .orderBy(desc(product.createdAt));
}

export type PublicProduct = {
  id: string;
  name: string;
  description: string | null;
  priceMinor: number;
  stock: number | null;
  /** storage keys, main image first */
  imageKeys: string[];
};

export async function getPublicProduct(
  storeId: string,
  productId: string,
): Promise<PublicProduct | null> {
  const [row] = await db
    .select({
      id: product.id,
      tenantId: product.tenantId, // internal: used below, never returned
      name: product.name,
      description: product.description,
      priceMinor: product.priceMinor,
      stock: product.stock,
    })
    .from(product)
    .innerJoin(store, and(eq(store.id, product.storeId), eq(store.tenantId, product.tenantId)))
    .where(and(publicProducts(storeId), eq(product.id, productId)))
    .limit(1);
  if (!row) return null;

  const images = await db
    .select({ key: productImage.storageKey })
    .from(productImage)
    .where(and(eq(productImage.productId, row.id), eq(productImage.tenantId, row.tenantId)))
    .orderBy(asc(productImage.position));

  return {
    id: row.id,
    name: row.name,
    description: row.description,
    priceMinor: row.priceMinor,
    stock: row.stock,
    imageKeys: images.map((image) => image.key),
  };
}

/**
 * Current public data for a set of product ids (the cart), same visibility rules as above:
 * ids that are unknown, not active, or from another store simply do not come back.
 */
export async function getPublicProductsByIds(
  storeId: string,
  productIds: string[],
): Promise<Map<string, PublicProductSummary>> {
  if (productIds.length === 0) return new Map();
  const rows = await db
    .select({
      id: product.id,
      name: product.name,
      priceMinor: product.priceMinor,
      stock: product.stock,
      imageKey: sql<string | null>`(
        select pi.storage_key from product_image pi
        where pi.product_id = ${product.id} and pi.tenant_id = ${product.tenantId}
        order by pi.position asc limit 1
      )`,
    })
    .from(product)
    .innerJoin(store, and(eq(store.id, product.storeId), eq(store.tenantId, product.tenantId)))
    .where(and(publicProducts(storeId), inArray(product.id, productIds)));
  return new Map(rows.map((row) => [row.id, row]));
}
