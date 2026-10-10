import { and, asc, category, count, db, eq, product, sql, store } from "@qvashop/db";
import { categorySlug } from "@/lib/slug";
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

export type CategoryResult = { ok: true } | { ok: false; error: "notFound" };

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Locks the store row (NO KEY UPDATE: product and category inserts can still reference it) so
 * two category saves of the same store run one after the other: identifiers and positions are
 * computed from what is already there, and they cannot pick the same one.
 */
async function lockStore(tx: Tx, scope: Scope) {
  await tx
    .select({ id: store.id })
    .from(store)
    .where(and(eq(store.id, scope.storeId), eq(store.tenantId, scope.tenantId)))
    .for("no key update");
}

/** Slugs of the store's other categories. */
async function takenSlugs(tx: Tx, scope: Scope, exceptId?: string) {
  const rows = await tx.select({ id: category.id, slug: category.slug }).from(category).where(inScope(scope));
  return rows.filter((row) => row.id !== exceptId).map((row) => row.slug);
}

/** Creates a category at the end of the list; its identifier comes from the name. */
export async function createCategory(scope: Scope, values: CategoryValues): Promise<CategoryResult> {
  await db.transaction(async (tx) => {
    await lockStore(tx, scope);
    const [{ next }] = await tx
      .select({ next: sql<number>`coalesce(max(${category.position}) + 1, 0)::int` })
      .from(category)
      .where(inScope(scope));
    const slug = categorySlug(values.name, await takenSlugs(tx, scope));
    await tx.insert(category).values({ ...scope, name: values.name, slug, position: next });
  });
  return { ok: true };
}

/** Renames a category; its identifier follows the new name (unchanged if the name is the same). */
export async function renameCategory(scope: Scope, id: string, values: CategoryValues): Promise<CategoryResult> {
  return db.transaction(async (tx) => {
    await lockStore(tx, scope);
    const [current] = await tx
      .select({ name: category.name })
      .from(category)
      .where(and(inScope(scope), eq(category.id, id)));
    if (!current) return { ok: false, error: "notFound" } as const;
    if (current.name === values.name) return { ok: true } as const;
    const slug = categorySlug(values.name, await takenSlugs(tx, scope, id));
    await tx.update(category).set({ name: values.name, slug }).where(and(inScope(scope), eq(category.id, id)));
    return { ok: true } as const;
  });
}

export async function setCategoryVisibility(scope: Scope, id: string, isVisible: boolean): Promise<CategoryResult> {
  const rows = await db
    .update(category)
    .set({ isVisible })
    .where(and(inScope(scope), eq(category.id, id)))
    .returning({ id: category.id });
  return rows.length === 1 ? { ok: true } : { ok: false, error: "notFound" };
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
