import {
  and,
  asc,
  category,
  count,
  db,
  desc,
  eq,
  isNull,
  product,
  productImage,
  productVariant,
  sql,
  variantPrice,
} from "@qvashop/db";
import type { ProductInput } from "@/lib/validation/product";
import { deleteObject } from "./storage";

// Every function takes `tenantId` + `storeId` and filters by them (CLAUDE.md: never query
// tenant data without a tenant_id filter). Get them from requireMerchant(), never from client
// input.
//
// Model: a product is what the customer sees; what is sold is a variant. A simple product
// has exactly one variant, the default one (no options), and the merchant edits its SKU,
// stock and prices as if they were the product's. A product with options has no default
// variant: its variants are edited in src/server/variants.ts, and here only its own fields.

type Scope = { tenantId: string; storeId: string };

const inScope = ({ tenantId, storeId }: Scope) =>
  and(eq(product.tenantId, tenantId), eq(product.storeId, storeId));

export async function listProducts(scope: Scope, currencyCode: string) {
  return db
    .select({
      id: product.id,
      name: product.name,
      slug: product.slug,
      status: product.status,
      categoryName: category.name,
      createdAt: product.createdAt,
      variantCount: sql<number>`(
        select count(*)::int from product_variant v
        where v.product_id = ${product.id} and v.tenant_id = ${product.tenantId}
      )`,
      // null when any variant does not track stock
      stock: sql<number | null>`(
        select case when bool_or(v.stock is null) then null else sum(v.stock)::int end
        from product_variant v
        where v.product_id = ${product.id} and v.tenant_id = ${product.tenantId}
      )`,
      // regular price for 1 unit in the store's default currency (lowest across variants)
      priceMinor: sql<number | null>`(
        select min(vp.amount_minor)::bigint from variant_price vp
        join product_variant v on v.id = vp.variant_id and v.tenant_id = vp.tenant_id
        where v.product_id = ${product.id} and v.tenant_id = ${product.tenantId}
          and vp.currency_code = ${currencyCode} and vp.min_quantity = 1 and vp.price_list_id is null
      )`,
    })
    .from(product)
    .leftJoin(category, and(eq(category.id, product.categoryId), eq(category.tenantId, product.tenantId)))
    .where(inScope(scope))
    .orderBy(desc(product.createdAt))
    .then((rows) => rows.map((row) => ({ ...row, priceMinor: row.priceMinor === null ? null : Number(row.priceMinor) })));
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

/**
 * Product + its default variant + that variant's regular prices (for the edit form).
 * `hasOptions`: the product has options, so it has no default variant.
 */
export async function getProduct(scope: Scope, id: string) {
  const [row] = await db
    .select({
      id: product.id,
      name: product.name,
      description: product.description,
      status: product.status,
      slug: product.slug,
      categoryId: product.categoryId,
      tags: product.tags,
      metaTitle: product.metaTitle,
      metaDescription: product.metaDescription,
    })
    .from(product)
    .where(and(inScope(scope), eq(product.id, id)))
    .limit(1);
  if (!row) return null;

  const variants = await db
    .select({ id: productVariant.id, sku: productVariant.sku, stock: productVariant.stock, isDefault: productVariant.isDefault })
    .from(productVariant)
    .where(and(eq(productVariant.productId, id), eq(productVariant.tenantId, scope.tenantId)))
    .orderBy(desc(productVariant.isDefault), asc(productVariant.position));
  const defaultVariant = variants.find((v) => v.isDefault) ?? variants[0];

  const prices = defaultVariant
    ? await db
        .select({
          currencyCode: variantPrice.currencyCode,
          minQuantity: variantPrice.minQuantity,
          amountMinor: variantPrice.amountMinor,
          compareAtMinor: variantPrice.compareAtMinor,
        })
        .from(variantPrice)
        .where(
          and(
            eq(variantPrice.variantId, defaultVariant.id),
            eq(variantPrice.tenantId, scope.tenantId),
            isNull(variantPrice.priceListId),
          ),
        )
        .orderBy(asc(variantPrice.currencyCode), asc(variantPrice.minQuantity))
    : [];

  const hasOptions = variants.length > 0 && !variants.some((v) => v.isDefault);
  if (hasOptions) return { ...row, variantCount: variants.length, hasOptions, defaultVariant: null, prices: [] };
  return { ...row, variantCount: variants.length, hasOptions, defaultVariant: defaultVariant ?? null, prices };
}

/** Does the product have options? null when it is not this store's product. */
export async function productHasOptions(scope: Scope, id: string): Promise<boolean | null> {
  const [row] = await db
    .select({ id: product.id, hasDefault: sql<boolean>`bool_or(${productVariant.isDefault})` })
    .from(product)
    .leftJoin(productVariant, and(eq(productVariant.productId, product.id), eq(productVariant.tenantId, product.tenantId)))
    .where(and(inScope(scope), eq(product.id, id)))
    .groupBy(product.id);
  if (!row) return null;
  return row.hasDefault === false;
}

export type SaveProductResult =
  | { ok: true; id: string }
  | { ok: false; error: "notFound" | "slugTaken" | "skuTaken" | "categoryNotFound" | "hasVariants" };

/** Postgres unique violation on a given constraint/index */
function uniqueViolation(error: unknown, name: string) {
  const e = error as { code?: string; constraint?: string; cause?: { code?: string; constraint?: string } };
  const inner = e?.cause ?? e;
  return inner?.code === "23505" && inner?.constraint === name;
}

async function categoryInStore(scope: Scope, categoryId: string | null) {
  if (!categoryId) return true;
  const [row] = await db
    .select({ id: category.id })
    .from(category)
    .where(and(eq(category.id, categoryId), eq(category.tenantId, scope.tenantId), eq(category.storeId, scope.storeId)))
    .limit(1);
  return Boolean(row);
}

function mapSaveError(error: unknown): SaveProductResult | null {
  if (uniqueViolation(error, "product_store_slug_unique")) return { ok: false, error: "slugTaken" };
  if (uniqueViolation(error, "product_variant_tenant_sku_idx")) return { ok: false, error: "skuTaken" };
  return null;
}

/** Creates a simple product: product + default variant + its regular prices. */
export async function createProduct(scope: Scope, input: ProductInput): Promise<SaveProductResult> {
  if (!(await categoryInStore(scope, input.product.categoryId))) {
    return { ok: false, error: "categoryNotFound" };
  }
  try {
    return await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(product)
        .values({ tenantId: scope.tenantId, storeId: scope.storeId, ...input.product })
        .returning({ id: product.id });
      const [variant] = await tx
        .insert(productVariant)
        .values({
          tenantId: scope.tenantId,
          storeId: scope.storeId,
          productId: created.id,
          isDefault: true,
          optionKey: "",
          sku: input.variant.sku,
          stock: input.variant.stock,
        })
        .returning({ id: productVariant.id });
      if (input.prices.length > 0) {
        await tx.insert(variantPrice).values(
          input.prices.map((price) => ({ tenantId: scope.tenantId, storeId: scope.storeId, variantId: variant.id, ...price })),
        );
      }
      return { ok: true as const, id: created.id };
    });
  } catch (error) {
    const mapped = mapSaveError(error);
    if (mapped) return mapped;
    throw error;
  }
}

/**
 * Updates a product's own fields. For a simple product also its default variant's SKU/stock
 * and regular prices (replaced as a whole; promotion prices are left alone). For a product with
 * options `input.variant` / `input.prices` are ignored: its variants have their own form.
 */
export async function updateProduct(scope: Scope, id: string, input: ProductInput): Promise<SaveProductResult> {
  if (!(await categoryInStore(scope, input.product.categoryId))) {
    return { ok: false, error: "categoryNotFound" };
  }
  try {
    return await db.transaction(async (tx) => {
      const rows = await tx
        .update(product)
        .set(input.product)
        .where(and(inScope(scope), eq(product.id, id)))
        .returning({ id: product.id });
      if (rows.length !== 1) return { ok: false as const, error: "notFound" as const };

      const variants = await tx
        .select({ id: productVariant.id, isDefault: productVariant.isDefault })
        .from(productVariant)
        .where(and(eq(productVariant.productId, id), eq(productVariant.tenantId, scope.tenantId)));
      const defaultVariant = variants.find((v) => v.isDefault);
      if (!defaultVariant) return { ok: true as const, id };
      if (variants.length !== 1) return { ok: false as const, error: "hasVariants" as const };
      const variantId = defaultVariant.id;

      await tx
        .update(productVariant)
        .set({ sku: input.variant.sku, stock: input.variant.stock })
        .where(and(eq(productVariant.id, variantId), eq(productVariant.tenantId, scope.tenantId)));
      await tx
        .delete(variantPrice)
        .where(
          and(eq(variantPrice.variantId, variantId), eq(variantPrice.tenantId, scope.tenantId), isNull(variantPrice.priceListId)),
        );
      if (input.prices.length > 0) {
        await tx.insert(variantPrice).values(
          input.prices.map((price) => ({ tenantId: scope.tenantId, storeId: scope.storeId, variantId, ...price })),
        );
      }
      return { ok: true as const, id };
    });
  } catch (error) {
    const mapped = mapSaveError(error);
    if (mapped) return mapped;
    throw error;
  }
}

/**
 * Deletes the product (variants, prices and image rows cascade) and then its image files.
 * Files are removed after the rows, so a storage failure leaves orphan files, never rows
 * pointing to nothing. false when the product does not exist in this tenant/store.
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
