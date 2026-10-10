import { and, asc, category, count, db, eq, product, sql } from "@qvashop/db";
import type { CategoryValues } from "@/lib/validation/catalog-settings";

// Store categories. Every function matches tenant_id AND store_id from requireMerchant().

type Scope = { tenantId: string; storeId: string };
const inScope = ({ tenantId, storeId }: Scope) =>
  and(eq(category.tenantId, tenantId), eq(category.storeId, storeId));

export async function listCategories(scope: Scope) {
  return db
    .select({
      id: category.id,
      name: category.name,
      slug: category.slug,
      position: category.position,
      isVisible: category.isVisible,
      productCount: count(product.id),
    })
    .from(category)
    // Joined on tenant too, so a product of another tenant can never be counted
    .leftJoin(product, and(eq(product.categoryId, category.id), eq(product.tenantId, category.tenantId)))
    .where(inScope(scope))
    .groupBy(category.id)
    .orderBy(asc(category.position), asc(category.name));
}

export type CategoryResult = { ok: true } | { ok: false; error: "notFound" | "slugTaken" };

function slugTaken(error: unknown) {
  const e = error as { code?: string; constraint?: string; cause?: { code?: string; constraint?: string } };
  const inner = e?.cause ?? e;
  return inner?.code === "23505" && inner?.constraint === "category_store_slug_unique";
}

export async function createCategory(scope: Scope, values: CategoryValues): Promise<CategoryResult> {
  try {
    await db.transaction(async (tx) => {
      const [{ next }] = await tx
        .select({ next: sql<number>`coalesce(max(${category.position}) + 1, 0)::int` })
        .from(category)
        .where(inScope(scope));
      await tx.insert(category).values({ ...scope, ...values, position: next });
    });
    return { ok: true };
  } catch (error) {
    if (slugTaken(error)) return { ok: false, error: "slugTaken" };
    throw error;
  }
}

export async function updateCategory(
  scope: Scope,
  id: string,
  values: Partial<CategoryValues> & { isVisible?: boolean },
): Promise<CategoryResult> {
  try {
    const rows = await db
      .update(category)
      .set(values)
      .where(and(inScope(scope), eq(category.id, id)))
      .returning({ id: category.id });
    return rows.length === 1 ? { ok: true } : { ok: false, error: "notFound" };
  } catch (error) {
    if (slugTaken(error)) return { ok: false, error: "slugTaken" };
    throw error;
  }
}

/** Moves a category one place up or down (swaps positions with its neighbour). */
export async function moveCategory(scope: Scope, id: string, direction: "up" | "down"): Promise<CategoryResult> {
  return db.transaction(async (tx) => {
    const all = await tx
      .select({ id: category.id })
      .from(category)
      .where(inScope(scope))
      .orderBy(asc(category.position), asc(category.name));
    const index = all.findIndex((c) => c.id === id);
    if (index < 0) return { ok: false, error: "notFound" } as const;
    const target = direction === "up" ? index - 1 : index + 1;
    if (target < 0 || target >= all.length) return { ok: true } as const;
    const ordered = [...all];
    [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
    // Rewrite every position as 0..n-1 so gaps or ties from the past disappear
    for (const [position, row] of ordered.entries()) {
      await tx.update(category).set({ position }).where(and(inScope(scope), eq(category.id, row.id)));
    }
    return { ok: true } as const;
  });
}

/** Deletes the category; its products stay, without a category (FK sets category_id NULL). */
export async function deleteCategory(scope: Scope, id: string): Promise<CategoryResult> {
  const rows = await db
    .delete(category)
    .where(and(inScope(scope), eq(category.id, id)))
    .returning({ id: category.id });
  return rows.length === 1 ? { ok: true } : { ok: false, error: "notFound" };
}
