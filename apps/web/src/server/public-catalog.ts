import {
  and,
  asc,
  category,
  db,
  desc,
  eq,
  inArray,
  or,
  product,
  productImage,
  productOption,
  productOptionValue,
  productVariant,
  sql,
  store,
  variantOptionValue,
} from "@qvashop/db";
import { resolvePrice, volumeTiers, type ResolvedPrice, type VolumeTier } from "@/lib/pricing";
import { searchScore, searchTerms } from "@/lib/search";
import { loadPriceRows } from "./pricing";

// Public catalog: what an anonymous visitor may see of a store's products.
//
// There is no signed-in tenant, so the safety is in the queries:
//  - a product is joined to its store through (store_id, tenant_id), the composite key the
//    database enforces, so it can only match its own store;
//  - only products with status "active" in a store with status "active" are returned;
//  - prices come from loadPriceRows (regular + active promotions) and resolvePrice();
//  - tenant_id never leaves this file.
// A product is offered in a currency only if at least one of its variants has a regular
// price there.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const publicProducts = (storeId: string) =>
  and(eq(store.id, storeId), eq(store.status, "active"), eq(product.status, "active"));

const mainImage = sql<string | null>`(
  select pi.storage_key from product_image pi
  where pi.product_id = ${product.id} and pi.tenant_id = ${product.tenantId}
  order by pi.position asc limit 1
)`;

type VariantRow = { id: string; productId: string; stock: number | null; isDefault: boolean; title: string | null; position: number };

async function variantsOf(productIds: string[]): Promise<Map<string, VariantRow[]>> {
  const result = new Map<string, VariantRow[]>();
  if (productIds.length === 0) return result;
  const rows = await db
    .select({
      id: productVariant.id,
      productId: productVariant.productId,
      stock: productVariant.stock,
      isDefault: productVariant.isDefault,
      title: productVariant.title,
      position: productVariant.position,
    })
    .from(productVariant)
    .where(inArray(productVariant.productId, productIds))
    .orderBy(desc(productVariant.isDefault), asc(productVariant.position));
  for (const row of rows) result.set(row.productId, [...(result.get(row.productId) ?? []), row]);
  return result;
}

export type PublicListItem = {
  id: string;
  slug: string;
  name: string;
  imageKey: string | null;
  categoryId: string | null;
  /** price of the cheapest variant for 1 unit (with promotion and compare-at) */
  price: ResolvedPrice;
  /** variants have different prices ("from ...") */
  priceVaries: boolean;
  /** every variant that is sold in this currency has stock 0 */
  soldOut: boolean;
};

export type PublicCategory = { id: string; name: string; slug: string };

type ListRow = { id: string; slug: string; name: string; categoryId: string | null; imageKey: string | null };

/** Prices the rows in a currency (cheapest variant, 1 unit); rows not sold in it are dropped. */
async function toListItems(storeId: string, currencyCode: string, rows: ListRow[]): Promise<PublicListItem[]> {
  const variants = await variantsOf(rows.map((r) => r.id));
  const prices = await loadPriceRows(storeId, [...variants.values()].flat().map((v) => v.id), currencyCode);

  const products: PublicListItem[] = [];
  for (const row of rows) {
    const sellable = (variants.get(row.id) ?? [])
      .map((v) => ({ v, price: resolvePrice(prices.get(v.id) ?? [], 1) }))
      .filter((x): x is { v: VariantRow; price: ResolvedPrice } => x.price !== null);
    if (sellable.length === 0) continue; // not offered in this currency
    const cheapest = sellable.reduce((a, b) => (b.price.unitMinor < a.price.unitMinor ? b : a));
    products.push({
      ...row,
      price: cheapest.price,
      priceVaries: new Set(sellable.map((x) => x.price.unitMinor)).size > 1,
      soldOut: sellable.every((x) => x.v.stock === 0),
    });
  }
  return products;
}

/** Catalog of a store in a currency: products and the visible categories that have any. */
export async function listPublicCatalog(
  storeId: string,
  currencyCode: string,
): Promise<{ categories: PublicCategory[]; products: PublicListItem[] }> {
  const rows = await db
    .select({
      id: product.id,
      slug: product.slug,
      name: product.name,
      categoryId: product.categoryId,
      imageKey: mainImage,
    })
    .from(product)
    .innerJoin(store, and(eq(store.id, product.storeId), eq(store.tenantId, product.tenantId)))
    .where(publicProducts(storeId))
    .orderBy(desc(product.createdAt));
  const products = await toListItems(storeId, currencyCode, rows);

  const used = new Set(products.map((p) => p.categoryId).filter(Boolean));
  const categories = (
    await db
      .select({ id: category.id, name: category.name, slug: category.slug })
      .from(category)
      .where(and(eq(category.storeId, storeId), eq(category.isVisible, true)))
      .orderBy(asc(category.position), asc(category.name))
  ).filter((c) => used.has(c.id));

  return { categories, products };
}

/**
 * The given products of a store in a currency, in the order of `ids` (e.g. a customer's
 * favorites). Products that are not public or not sold in the currency are left out.
 */
export async function listPublicProductsByIds(storeId: string, currencyCode: string, ids: string[]): Promise<PublicListItem[]> {
  const wanted = ids.filter((id) => UUID.test(id));
  if (wanted.length === 0) return [];
  const rows = await db
    .select({
      id: product.id,
      slug: product.slug,
      name: product.name,
      categoryId: product.categoryId,
      imageKey: mainImage,
    })
    .from(product)
    .innerJoin(store, and(eq(store.id, product.storeId), eq(store.tenantId, product.tenantId)))
    .where(and(publicProducts(storeId), inArray(product.id, wanted)));
  const order = new Map(wanted.map((id, index) => [id, index]));
  rows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  return toListItems(storeId, currencyCode, rows);
}

export const SEARCH_RESULTS_MAX = 60;

/**
 * Products of the store matching a query (name, tags, visible category, description;
 * accents and case ignored, see searchScore), best matches first, at most `limit`.
 */
export async function searchPublicCatalog(
  storeId: string,
  currencyCode: string,
  query: string,
  limit = SEARCH_RESULTS_MAX,
): Promise<PublicListItem[]> {
  const terms = searchTerms(query);
  if (terms.length === 0) return [];
  const rows = await db
    .select({
      id: product.id,
      slug: product.slug,
      name: product.name,
      categoryId: product.categoryId,
      imageKey: mainImage,
      tags: product.tags,
      description: product.description,
      // A hidden category does not exist for the public, so its name finds nothing
      categoryName: sql<string | null>`case when ${category.isVisible} then ${category.name} end`,
    })
    .from(product)
    .innerJoin(store, and(eq(store.id, product.storeId), eq(store.tenantId, product.tenantId)))
    .leftJoin(category, and(eq(category.id, product.categoryId), eq(category.tenantId, product.tenantId)))
    .where(publicProducts(storeId))
    .orderBy(desc(product.createdAt));

  const matches = rows
    .map((row) => ({ row, score: searchScore(terms, row) }))
    .filter((x): x is { row: (typeof rows)[number]; score: number } => x.score !== null)
    .sort((a, b) => b.score - a.score) // stable: equal scores stay newest first
    // Only the best ones get priced; some extra, since products not sold in this currency drop out
    .slice(0, limit * 2)
    .map(({ row: { id, slug, name, categoryId, imageKey } }) => ({ id, slug, name, categoryId, imageKey }));
  return (await toListItems(storeId, currencyCode, matches)).slice(0, limit);
}

export type PublicVariant = {
  id: string;
  title: string | null;
  isDefault: boolean;
  /** one value per option of the product (empty for a simple product) */
  optionValueIds: string[];
  stock: number | null;
  /** null = not sold in this currency */
  price: ResolvedPrice | null;
  tiers: VolumeTier[];
};

export type PublicProduct = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  metaTitle: string | null;
  metaDescription: string | null;
  category: { name: string; slug: string } | null;
  /** storage keys, main image first */
  imageKeys: string[];
  /** e.g. Talla: S, M, L (empty for a simple product) */
  options: { id: string; name: string; values: { id: string; value: string }[] }[];
  variants: PublicVariant[];
};

/** A public product by its slug (or by its id, for old links). */
export async function getPublicProduct(
  storeId: string,
  slugOrId: string,
  currencyCode: string,
): Promise<PublicProduct | null> {
  const match = UUID.test(slugOrId)
    ? or(eq(product.slug, slugOrId.toLowerCase()), eq(product.id, slugOrId.toLowerCase()))
    : eq(product.slug, slugOrId.toLowerCase());
  const [row] = await db
    .select({
      id: product.id,
      tenantId: product.tenantId, // internal: used below, never returned
      slug: product.slug,
      name: product.name,
      description: product.description,
      metaTitle: product.metaTitle,
      metaDescription: product.metaDescription,
      categoryName: category.name,
      categorySlug: category.slug,
      categoryVisible: category.isVisible,
    })
    .from(product)
    .innerJoin(store, and(eq(store.id, product.storeId), eq(store.tenantId, product.tenantId)))
    .leftJoin(category, and(eq(category.id, product.categoryId), eq(category.tenantId, product.tenantId)))
    .where(and(publicProducts(storeId), match))
    .limit(1);
  if (!row) return null;

  const images = await db
    .select({ key: productImage.storageKey })
    .from(productImage)
    .where(and(eq(productImage.productId, row.id), eq(productImage.tenantId, row.tenantId)))
    .orderBy(asc(productImage.position));

  const variants = (await variantsOf([row.id])).get(row.id) ?? [];
  const prices = await loadPriceRows(storeId, variants.map((v) => v.id), currencyCode);

  const options = await db
    .select({ id: productOption.id, name: productOption.name })
    .from(productOption)
    .where(and(eq(productOption.productId, row.id), eq(productOption.tenantId, row.tenantId)))
    .orderBy(asc(productOption.position));
  const values = options.length
    ? await db
        .select({ id: productOptionValue.id, optionId: productOptionValue.optionId, value: productOptionValue.value })
        .from(productOptionValue)
        .where(and(inArray(productOptionValue.optionId, options.map((o) => o.id)), eq(productOptionValue.tenantId, row.tenantId)))
        .orderBy(asc(productOptionValue.position))
    : [];
  const links = options.length && variants.length
    ? await db
        .select({ variantId: variantOptionValue.variantId, valueId: variantOptionValue.optionValueId })
        .from(variantOptionValue)
        .where(and(inArray(variantOptionValue.variantId, variants.map((v) => v.id)), eq(variantOptionValue.tenantId, row.tenantId)))
    : [];
  const optionOrder = new Map(values.map((v) => [v.id, options.findIndex((o) => o.id === v.optionId)]));

  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    metaTitle: row.metaTitle,
    metaDescription: row.metaDescription,
    category: row.categoryName && row.categorySlug && row.categoryVisible ? { name: row.categoryName, slug: row.categorySlug } : null,
    imageKeys: images.map((image) => image.key),
    options: options.map((o) => ({
      id: o.id,
      name: o.name,
      values: values.filter((v) => v.optionId === o.id).map(({ id, value }) => ({ id, value })),
    })),
    variants: variants.map((v) => ({
      id: v.id,
      title: v.title,
      isDefault: v.isDefault,
      optionValueIds: links
        .filter((l) => l.variantId === v.id)
        .map((l) => l.valueId)
        .sort((a, b) => (optionOrder.get(a) ?? 0) - (optionOrder.get(b) ?? 0)),
      stock: v.stock,
      price: resolvePrice(prices.get(v.id) ?? [], 1),
      tiers: volumeTiers(prices.get(v.id) ?? []),
    })),
  };
}

export type PublicCartVariant = {
  id: string;
  productId: string;
  productSlug: string;
  name: string;
  title: string | null;
  stock: number | null;
  imageKey: string | null;
};

/**
 * Current public data of the variants in a cart. Unknown ids, variants of hidden products
 * and variants of another store simply do not come back.
 */
export async function getPublicVariants(storeId: string, variantIds: string[]): Promise<Map<string, PublicCartVariant>> {
  if (variantIds.length === 0) return new Map();
  const rows = await db
    .select({
      id: productVariant.id,
      productId: product.id,
      productSlug: product.slug,
      name: product.name,
      title: productVariant.title,
      stock: productVariant.stock,
      imageKey: mainImage,
    })
    .from(productVariant)
    .innerJoin(
      product,
      and(
        eq(product.id, productVariant.productId),
        eq(product.storeId, productVariant.storeId),
        eq(product.tenantId, productVariant.tenantId),
      ),
    )
    .innerJoin(store, and(eq(store.id, product.storeId), eq(store.tenantId, product.tenantId)))
    .where(and(publicProducts(storeId), inArray(productVariant.id, variantIds)));
  return new Map(rows.map((row) => [row.id, row]));
}
