import { and, asc, count, db, desc, eq, product } from "@qvashop/db";

// Every function takes `tenantId` and filters by it (CLAUDE.md: never query tenant data
// without a tenant_id filter). Get it from requireMerchant(), never from client input.

type Scope = { tenantId: string; storeId: string };

export async function listProducts({ tenantId, storeId }: Scope) {
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
    .where(and(eq(product.tenantId, tenantId), eq(product.storeId, storeId)))
    .orderBy(desc(product.createdAt));
}

export async function countProductsByStatus({ tenantId, storeId }: Scope) {
  const rows = await db
    .select({ status: product.status, total: count() })
    .from(product)
    .where(and(eq(product.tenantId, tenantId), eq(product.storeId, storeId)))
    .groupBy(product.status)
    .orderBy(asc(product.status));
  return Object.fromEntries(rows.map((r) => [r.status, r.total])) as Partial<
    Record<"draft" | "active" | "archived", number>
  >;
}
