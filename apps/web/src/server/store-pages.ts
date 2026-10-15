import { and, asc, count, db, eq, store, storePage } from "@qvashop/db";
import { MAX_STORE_PAGES } from "@/lib/store-pages";
import type { StorePageValues } from "@/lib/validation/store-page";

// Custom store pages. Every function matches tenant_id AND store_id from requireMerchant().

type Scope = { tenantId: string; storeId: string };
const inScope = ({ tenantId, storeId }: Scope) =>
  and(eq(storePage.tenantId, tenantId), eq(storePage.storeId, storeId));

export async function listStorePages(scope: Scope) {
  return db
    .select({
      id: storePage.id,
      title: storePage.title,
      slug: storePage.slug,
      status: storePage.status,
      updatedAt: storePage.updatedAt,
    })
    .from(storePage)
    .where(inScope(scope))
    .orderBy(asc(storePage.title));
}

export async function getStorePage(scope: Scope, id: string) {
  const [row] = await db
    .select({
      id: storePage.id,
      title: storePage.title,
      slug: storePage.slug,
      content: storePage.content,
      status: storePage.status,
      metaTitle: storePage.metaTitle,
      metaDescription: storePage.metaDescription,
    })
    .from(storePage)
    .where(and(inScope(scope), eq(storePage.id, id)));
  return row ?? null;
}

export type SaveStorePageResult =
  | { ok: true; id: string }
  | { ok: false; error: "notFound" | "slugTaken" | "limit" };

function toRow(values: StorePageValues) {
  const orNull = (text: string) => (text === "" ? null : text);
  return {
    title: values.title,
    slug: values.slug,
    content: values.content,
    status: values.status,
    metaTitle: orNull(values.metaTitle),
    metaDescription: orNull(values.metaDescription),
  };
}

function slugTaken(error: unknown) {
  const e = error as { code?: string; constraint?: string; cause?: { code?: string; constraint?: string } };
  const inner = e?.cause ?? e;
  return inner?.code === "23505" && inner?.constraint === "store_page_store_slug_unique";
}

/**
 * Creates a page. The store row is locked (NO KEY UPDATE: inserts can still reference it) so
 * two simultaneous creations cannot both pass the per-store limit.
 */
export async function createStorePage(scope: Scope, values: StorePageValues): Promise<SaveStorePageResult> {
  try {
    return await db.transaction(async (tx) => {
      await tx
        .select({ id: store.id })
        .from(store)
        .where(and(eq(store.id, scope.storeId), eq(store.tenantId, scope.tenantId)))
        .for("no key update");
      const [{ total }] = await tx.select({ total: count() }).from(storePage).where(inScope(scope));
      if (total >= MAX_STORE_PAGES) return { ok: false, error: "limit" } as const;
      const [row] = await tx
        .insert(storePage)
        .values({ ...scope, ...toRow(values) })
        .returning({ id: storePage.id });
      return { ok: true, id: row.id } as const;
    });
  } catch (error) {
    if (slugTaken(error)) return { ok: false, error: "slugTaken" };
    throw error;
  }
}

export async function updateStorePage(scope: Scope, id: string, values: StorePageValues): Promise<SaveStorePageResult> {
  try {
    const rows = await db
      .update(storePage)
      .set(toRow(values))
      .where(and(inScope(scope), eq(storePage.id, id)))
      .returning({ id: storePage.id });
    return rows.length === 1 ? { ok: true, id } : { ok: false, error: "notFound" };
  } catch (error) {
    if (slugTaken(error)) return { ok: false, error: "slugTaken" };
    throw error;
  }
}

export async function deleteStorePage(scope: Scope, id: string): Promise<boolean> {
  const rows = await db
    .delete(storePage)
    .where(and(inScope(scope), eq(storePage.id, id)))
    .returning({ id: storePage.id });
  return rows.length === 1;
}
