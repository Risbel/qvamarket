import {
  and,
  asc,
  count,
  db,
  desc,
  eq,
  product,
  productImage,
} from "@qvashop/db";
import { deleteObject } from "./storage";

// Every function takes `tenantId` and filters by it (CLAUDE.md: never query tenant data
// without a tenant_id filter). Get it from requireMerchant(), never from client input.

type Scope = { tenantId: string; storeId: string };

/** Values already validated and converted (see toProductData). */
export type ProductData = {
  name: string;
  description: string | null;
  priceMinor: number;
  stock: number | null;
  status: "draft" | "active" | "archived";
};

const inScope = ({ tenantId, storeId }: Scope) =>
  and(eq(product.tenantId, tenantId), eq(product.storeId, storeId));

export async function listProducts(scope: Scope) {
  return db
    .select({
      id: product.id,
      name: product.name,
      priceMinor: product.priceMinor,
      stock: product.stock,
      status: product.status,
      createdAt: product.createdAt,
    })
    .from(product)
    .where(inScope(scope))
    .orderBy(desc(product.createdAt));
}

export async function getProduct(scope: Scope, id: string) {
  const [row] = await db
    .select({
      id: product.id,
      name: product.name,
      description: product.description,
      priceMinor: product.priceMinor,
      stock: product.stock,
      status: product.status,
    })
    .from(product)
    .where(and(inScope(scope), eq(product.id, id)))
    .limit(1);
  return row ?? null;
}

export async function countProductsByStatus(scope: Scope) {
  const rows = await db
    .select({ status: product.status, total: count() })
    .from(product)
    .where(inScope(scope))
    .groupBy(product.status)
    .orderBy(asc(product.status));
  return Object.fromEntries(rows.map((r) => [r.status, r.total])) as Partial<
    Record<"draft" | "active" | "archived", number>
  >;
}

export async function createProduct(scope: Scope, data: ProductData) {
  const [row] = await db
    .insert(product)
    .values({ tenantId: scope.tenantId, storeId: scope.storeId, ...data })
    .returning({ id: product.id });
  return row.id;
}

/** false when the product does not exist in this tenant/store (nothing is updated). */
export async function updateProduct(scope: Scope, id: string, data: ProductData) {
  const rows = await db
    .update(product)
    .set(data)
    .where(and(inScope(scope), eq(product.id, id)))
    .returning({ id: product.id });
  return rows.length === 1;
}

/**
 * Deletes the product (its image rows cascade) and then its image files. Files are removed
 * after the rows, so a storage failure leaves orphan files, never rows pointing to nothing.
 * false when the product does not exist in this tenant/store.
 */
export async function deleteProduct(scope: Scope, id: string) {
  const images = await db
    .select({ key: productImage.storageKey })
    .from(productImage)
    .where(and(eq(productImage.tenantId, scope.tenantId), eq(productImage.productId, id)));

  const rows = await db
    .delete(product)
    .where(and(inScope(scope), eq(product.id, id)))
    .returning({ id: product.id });
  if (rows.length === 0) return false;

  await Promise.all(
    images.map(({ key }) =>
      deleteObject(key).catch((error) =>
        console.error("deleteProduct: could not delete file", key, error),
      ),
    ),
  );
  return true;
}
