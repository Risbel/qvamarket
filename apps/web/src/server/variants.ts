import {
  and,
  asc,
  db,
  eq,
  inArray,
  isNull,
  product,
  productOption,
  productOptionValue,
  productVariant,
  variantOptionValue,
  variantPrice,
} from "@qvashop/db";
import { formStockChange } from "@/lib/inventory";
import type { OptionsFormValues, VariantInput } from "@/lib/validation/product";
import { recordMovements, type Movement } from "./inventory-ledger";
import { planVariants, type PlanOption } from "@/lib/variant-plan";

// Options and variants of a product (merchant side). Every function takes the tenant scope from
// requireMerchant() and filters by it; each write runs in a transaction that first locks the
// product row, so two saves of the same product run one after the other.

type Scope = { tenantId: string; storeId: string };
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const productInScope = ({ tenantId, storeId }: Scope, id: string) =>
  and(eq(product.tenantId, tenantId), eq(product.storeId, storeId), eq(product.id, id));

async function lockProduct(tx: Tx, scope: Scope, productId: string) {
  const [row] = await tx.select({ id: product.id }).from(product).where(productInScope(scope, productId)).for("update");
  return Boolean(row);
}

const regularPriceColumns = {
  variantId: variantPrice.variantId,
  currencyCode: variantPrice.currencyCode,
  minQuantity: variantPrice.minQuantity,
  amountMinor: variantPrice.amountMinor,
  compareAtMinor: variantPrice.compareAtMinor,
};

export type ProductOptionView = { id: string; name: string; values: { id: string; value: string }[] };
export type VariantView = {
  id: string;
  title: string | null;
  sku: string | null;
  stock: number | null;
  prices: { currencyCode: string; minQuantity: number; amountMinor: number; compareAtMinor: number | null }[];
};

/** Options (with values) and variants (with regular prices) of a product, in display order. */
export async function getProductVariants(scope: Scope, productId: string) {
  const options = await db
    .select({ id: productOption.id, name: productOption.name })
    .from(productOption)
    .innerJoin(product, and(eq(product.id, productOption.productId), eq(product.tenantId, productOption.tenantId)))
    .where(productInScope(scope, productId))
    .orderBy(asc(productOption.position));
  const values = options.length
    ? await db
        .select({ id: productOptionValue.id, optionId: productOptionValue.optionId, value: productOptionValue.value })
        .from(productOptionValue)
        .where(
          and(
            inArray(productOptionValue.optionId, options.map((o) => o.id)),
            eq(productOptionValue.tenantId, scope.tenantId),
          ),
        )
        .orderBy(asc(productOptionValue.position))
    : [];

  const variants = await db
    .select({ id: productVariant.id, title: productVariant.title, sku: productVariant.sku, stock: productVariant.stock })
    .from(productVariant)
    .where(
      and(
        eq(productVariant.productId, productId),
        eq(productVariant.tenantId, scope.tenantId),
        eq(productVariant.storeId, scope.storeId),
      ),
    )
    .orderBy(asc(productVariant.position), asc(productVariant.createdAt));
  const prices = variants.length
    ? await db
        .select(regularPriceColumns)
        .from(variantPrice)
        .where(
          and(
            inArray(variantPrice.variantId, variants.map((v) => v.id)),
            eq(variantPrice.tenantId, scope.tenantId),
            isNull(variantPrice.priceListId),
          ),
        )
        .orderBy(asc(variantPrice.currencyCode), asc(variantPrice.minQuantity))
    : [];

  return {
    options: options.map((o) => ({ ...o, values: values.filter((v) => v.optionId === o.id).map(({ id, value }) => ({ id, value })) })),
    variants: variants.map((v) => ({
      ...v,
      prices: prices
        .filter((p) => p.variantId === v.id)
        .map((p) => ({ currencyCode: p.currencyCode, minQuantity: p.minQuantity, amountMinor: p.amountMinor, compareAtMinor: p.compareAtMinor })),
    })),
  } satisfies { options: ProductOptionView[]; variants: VariantView[] };
}

export type SetOptionsResult = { ok: true } | { ok: false; error: "notFound" | "stale" };

/**
 * Replaces the options of a product and regenerates its variants (see planVariants: existing
 * variants keep their prices and stock wherever they still fit). New variants copy the regular
 * prices of the first remaining variant and start with stock 0 if that variant tracks stock
 * (untracked otherwise), so nothing is oversold. No options = back to a simple product: the
 * first variant becomes the default one. `stale`: ids that are not this product's (the form
 * was opened before another change).
 */
export async function setProductOptions(
  scope: Scope,
  productId: string,
  options: OptionsFormValues["options"],
): Promise<SetOptionsResult> {
  return db.transaction(async (tx) => {
    if (!(await lockProduct(tx, scope, productId))) return { ok: false, error: "notFound" } as const;
    const tenant = scope.tenantId;

    const currentOptions = await tx
      .select({ id: productOption.id })
      .from(productOption)
      .where(and(eq(productOption.productId, productId), eq(productOption.tenantId, tenant)));
    const currentValues = currentOptions.length
      ? await tx
          .select({ id: productOptionValue.id, optionId: productOptionValue.optionId })
          .from(productOptionValue)
          .where(and(inArray(productOptionValue.optionId, currentOptions.map((o) => o.id)), eq(productOptionValue.tenantId, tenant)))
      : [];

    // Ids sent by the browser must belong to this product, and a value stays in its option
    const optionIds = new Set(currentOptions.map((o) => o.id));
    const optionOfValue = new Map(currentValues.map((v) => [v.id, v.optionId]));
    for (const option of options) {
      if (option.id && !optionIds.has(option.id)) return { ok: false, error: "stale" } as const;
      for (const entry of option.values) {
        if (entry.id && (!option.id || optionOfValue.get(entry.id) !== option.id)) return { ok: false, error: "stale" } as const;
      }
    }

    const variants = await tx
      .select({ id: productVariant.id, isDefault: productVariant.isDefault, stock: productVariant.stock })
      .from(productVariant)
      .where(and(eq(productVariant.productId, productId), eq(productVariant.tenantId, tenant)))
      .orderBy(asc(productVariant.position), asc(productVariant.createdAt));
    const links = variants.length
      ? await tx
          .select({ variantId: variantOptionValue.variantId, valueId: variantOptionValue.optionValueId })
          .from(variantOptionValue)
          .where(and(inArray(variantOptionValue.variantId, variants.map((v) => v.id)), eq(variantOptionValue.tenantId, tenant)))
      : [];

    // 1. Options and values that are gone (their variant links cascade)
    const keptOptionIds = new Set(options.map((o) => o.id).filter(Boolean));
    const removedOptions = currentOptions.map((o) => o.id).filter((id) => !keptOptionIds.has(id));
    if (removedOptions.length) {
      await tx.delete(productOption).where(and(inArray(productOption.id, removedOptions), eq(productOption.tenantId, tenant)));
    }
    const keptValueIds = new Set(options.flatMap((o) => o.values.map((v) => v.id)).filter(Boolean));
    const removedValues = currentValues
      .filter((v) => !keptValueIds.has(v.id) && keptOptionIds.has(v.optionId))
      .map((v) => v.id);
    if (removedValues.length) {
      await tx
        .delete(productOptionValue)
        .where(and(inArray(productOptionValue.id, removedValues), eq(productOptionValue.tenantId, tenant)));
    }

    // 2. Renames go through a temporary name, so swapping two names never hits the unique constraints
    for (const option of options.filter((o) => o.id)) {
      await tx
        .update(productOption)
        .set({ name: `~${option.id}` })
        .where(and(eq(productOption.id, option.id), eq(productOption.tenantId, tenant)));
      for (const entry of option.values.filter((v) => v.id)) {
        await tx
          .update(productOptionValue)
          .set({ value: `~${entry.id}` })
          .where(and(eq(productOptionValue.id, entry.id), eq(productOptionValue.tenantId, tenant)));
      }
    }

    // 3. Final names and positions; new options and values are inserted
    const planOptions: PlanOption[] = [];
    for (const [position, option] of options.entries()) {
      let optionId = option.id;
      if (optionId) {
        await tx
          .update(productOption)
          .set({ name: option.name, position })
          .where(and(eq(productOption.id, optionId), eq(productOption.tenantId, tenant)));
      } else {
        const [created] = await tx
          .insert(productOption)
          .values({ tenantId: tenant, productId, name: option.name, position })
          .returning({ id: productOption.id });
        optionId = created.id;
      }
      const values: PlanOption["values"] = [];
      for (const [valuePosition, entry] of option.values.entries()) {
        let valueId = entry.id;
        if (valueId) {
          await tx
            .update(productOptionValue)
            .set({ value: entry.value, position: valuePosition })
            .where(and(eq(productOptionValue.id, valueId), eq(productOptionValue.tenantId, tenant)));
        } else {
          const [created] = await tx
            .insert(productOptionValue)
            .values({ tenantId: tenant, optionId, value: entry.value, position: valuePosition })
            .returning({ id: productOptionValue.id });
          valueId = created.id;
        }
        values.push({ id: valueId, value: entry.value });
      }
      planOptions.push({ values });
    }

    const variantWhere = (id: string) => and(eq(productVariant.id, id), eq(productVariant.tenantId, tenant));

    // 4a. No options: back to a simple product
    if (options.length === 0) {
      if (variants.length === 0 || variants.some((v) => v.isDefault)) return { ok: true } as const;
      const [first, ...rest] = variants;
      if (rest.length) {
        await tx.delete(productVariant).where(and(inArray(productVariant.id, rest.map((v) => v.id)), eq(productVariant.tenantId, tenant)));
      }
      await tx.update(productVariant).set({ isDefault: true, optionKey: "", title: null, position: 0 }).where(variantWhere(first.id));
      return { ok: true } as const;
    }

    // 4b. Variants from the options
    const plan = planVariants(
      planOptions,
      variants.map((v) => ({ id: v.id, valueIds: links.filter((l) => l.variantId === v.id).map((l) => l.valueId) })),
    );
    const keptIds = new Set(plan.keep.map((k) => k.variantId));
    const template = variants.find((v) => keptIds.has(v.id)) ?? variants[0];
    const templatePrices = template
      ? await tx
          .select(regularPriceColumns)
          .from(variantPrice)
          .where(and(eq(variantPrice.variantId, template.id), eq(variantPrice.tenantId, tenant), isNull(variantPrice.priceListId)))
      : [];
    const newStock = template && template.stock !== null ? 0 : null;

    if (plan.remove.length) {
      await tx.delete(productVariant).where(and(inArray(productVariant.id, plan.remove), eq(productVariant.tenantId, tenant)));
    }
    const moved = plan.keep.filter((k) => k.changed);
    for (const k of moved) {
      await tx.update(productVariant).set({ optionKey: `~${k.variantId}` }).where(variantWhere(k.variantId));
    }
    if (moved.length) {
      await tx
        .delete(variantOptionValue)
        .where(and(inArray(variantOptionValue.variantId, moved.map((k) => k.variantId)), eq(variantOptionValue.tenantId, tenant)));
      await tx.insert(variantOptionValue).values(
        moved.flatMap((k) => k.combination.valueIds.map((optionValueId) => ({ tenantId: tenant, variantId: k.variantId, optionValueId }))),
      );
    }
    for (const k of plan.keep) {
      await tx
        .update(productVariant)
        .set({ isDefault: false, optionKey: k.combination.key, title: k.combination.title, position: k.position })
        .where(variantWhere(k.variantId));
    }

    for (const c of plan.create) {
      const [created] = await tx
        .insert(productVariant)
        .values({
          tenantId: tenant,
          storeId: scope.storeId,
          productId,
          optionKey: c.combination.key,
          title: c.combination.title,
          position: c.position,
          stock: newStock,
        })
        .returning({ id: productVariant.id });
      await tx
        .insert(variantOptionValue)
        .values(c.combination.valueIds.map((optionValueId) => ({ tenantId: tenant, variantId: created.id, optionValueId })));
      if (templatePrices.length) {
        await tx.insert(variantPrice).values(
          templatePrices.map((price) => ({ ...price, tenantId: tenant, storeId: scope.storeId, variantId: created.id })),
        );
      }
    }
    return { ok: true } as const;
  });
}

export type SaveVariantsResult =
  | { ok: true }
  | { ok: false; error: "notFound" | "stale" }
  | { ok: false; error: "skuTaken"; indexes: number[] };

/**
 * Saves SKU, stock and regular prices of every variant of a product with options (promotion
 * prices are left alone). The form must contain exactly the product's current variants,
 * otherwise `stale` (the options changed since it was opened). Stock follows
 * formStockChange() per variant; a new count over a stock that moved meanwhile (an order) is
 * `stale` too, so the merchant sees the current stock before counting again.
 */
export async function saveVariants(
  scope: Scope,
  productId: string,
  input: VariantInput[],
  actorUserId: string,
): Promise<SaveVariantsResult> {
  return db.transaction(async (tx) => {
    if (!(await lockProduct(tx, scope, productId))) return { ok: false, error: "notFound" } as const;
    const tenant = scope.tenantId;

    // Locked like checkout locks them, so a sale cannot slip between reading and writing the stock
    const variants = await tx
      .select({ id: productVariant.id, isDefault: productVariant.isDefault, stock: productVariant.stock })
      .from(productVariant)
      .where(and(eq(productVariant.productId, productId), eq(productVariant.tenantId, tenant)))
      .orderBy(asc(productVariant.id))
      .for("no key update");
    const current = new Set(variants.map((v) => v.id));
    const sent = new Set(input.map((v) => v.id));
    if (variants.some((v) => v.isDefault) || current.size !== sent.size || [...sent].some((id) => !current.has(id))) {
      return { ok: false, error: "stale" } as const;
    }

    // SKUs are unique per company: report which rows clash with another product's variant
    const skus = input.map((v) => v.sku).filter((sku): sku is string => sku !== null);
    if (skus.length) {
      const clashes = await tx
        .select({ id: productVariant.id, sku: productVariant.sku })
        .from(productVariant)
        .where(and(eq(productVariant.tenantId, tenant), inArray(productVariant.sku, skus)));
      const taken = new Set(clashes.filter((c) => !current.has(c.id)).map((c) => c.sku));
      const indexes = input.flatMap((v, i) => (v.sku !== null && taken.has(v.sku) ? [i] : []));
      if (indexes.length) return { ok: false, error: "skuTaken", indexes } as const;
    }

    const stockOf = new Map(variants.map((v) => [v.id, v.stock]));
    const changes = input.map((variant) => formStockChange(stockOf.get(variant.id) ?? null, variant.stockLoaded, variant.stock));
    if (changes.some((change) => change.kind === "stale")) return { ok: false, error: "stale" } as const;

    const ids = [...current];
    // SKUs are cleared first, so two variants can swap theirs
    await tx.update(productVariant).set({ sku: null }).where(and(inArray(productVariant.id, ids), eq(productVariant.tenantId, tenant)));
    const movements: Movement[] = [];
    for (const [i, variant] of input.entries()) {
      const change = changes[i];
      await tx
        .update(productVariant)
        .set({ sku: variant.sku, ...(change.kind === "set" ? { stock: change.stock } : {}) })
        .where(and(eq(productVariant.id, variant.id), eq(productVariant.tenantId, tenant)));
      if (change.kind === "set" && change.stock !== null) {
        movements.push({ variantId: variant.id, reason: change.reason, delta: change.delta, stockAfter: change.stock, actorUserId });
      }
    }
    await recordMovements(tx, scope, movements);
    await tx
      .delete(variantPrice)
      .where(and(inArray(variantPrice.variantId, ids), eq(variantPrice.tenantId, tenant), isNull(variantPrice.priceListId)));
    const rows = input.flatMap((variant) =>
      variant.prices.map((price) => ({ ...price, tenantId: tenant, storeId: scope.storeId, variantId: variant.id })),
    );
    if (rows.length) await tx.insert(variantPrice).values(rows);
    return { ok: true } as const;
  });
}
