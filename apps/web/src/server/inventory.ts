import { and, asc, db, desc, eq, inventoryMovement, order, product, productVariant, sql, user } from "@qvashop/db";
import { averageCost, HISTORY_MAX, stockAfter, type AdjustMode, type InventoryReason } from "@/lib/inventory";
import { recordMovements } from "./inventory-ledger";

// Inventory of the merchant's store: stock and unit cost of every variant, manual stock
// changes and their history. Every query matches tenant_id AND store_id (from
// requireMerchant(), never from client input).

type Scope = { tenantId: string; storeId: string };

const variantInScope = ({ tenantId, storeId }: Scope) =>
  and(eq(productVariant.tenantId, tenantId), eq(productVariant.storeId, storeId));

/** Every variant of the store with its product, stock and cost (products by name, variants in order). */
export async function listInventory(scope: Scope) {
  return db
    .select({
      id: productVariant.id,
      productId: product.id,
      productName: product.name,
      productStatus: product.status,
      title: productVariant.title,
      sku: productVariant.sku,
      stock: productVariant.stock,
      costMinor: productVariant.costMinor,
      costCurrencyCode: productVariant.costCurrencyCode,
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
    .where(variantInScope(scope))
    .orderBy(sql`${product.name} collate "und-x-icu"`, asc(product.id), asc(productVariant.position), asc(productVariant.id));
}

/** One variant with its product and its latest movements (newest first), or null. */
export async function getVariantHistory(scope: Scope, variantId: string) {
  const [variant] = await db
    .select({
      id: productVariant.id,
      productId: product.id,
      productName: product.name,
      title: productVariant.title,
      sku: productVariant.sku,
      stock: productVariant.stock,
      costMinor: productVariant.costMinor,
      costCurrencyCode: productVariant.costCurrencyCode,
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
    .where(and(variantInScope(scope), eq(productVariant.id, variantId)))
    .limit(1);
  if (!variant) return null;

  const movements = await db
    .select({
      id: inventoryMovement.id,
      reason: inventoryMovement.reason,
      delta: inventoryMovement.delta,
      stockAfter: inventoryMovement.stockAfter,
      unitCostMinor: inventoryMovement.unitCostMinor,
      costCurrencyCode: inventoryMovement.costCurrencyCode,
      note: inventoryMovement.note,
      createdAt: inventoryMovement.createdAt,
      actorName: user.name,
      orderId: order.id,
      orderNumber: order.number,
    })
    .from(inventoryMovement)
    .leftJoin(user, eq(user.id, inventoryMovement.actorUserId))
    .leftJoin(order, and(eq(order.id, inventoryMovement.orderId), eq(order.tenantId, inventoryMovement.tenantId)))
    .where(
      and(
        eq(inventoryMovement.tenantId, scope.tenantId),
        eq(inventoryMovement.storeId, scope.storeId),
        eq(inventoryMovement.variantId, variantId),
      ),
    )
    .orderBy(desc(inventoryMovement.createdAt), desc(inventoryMovement.id))
    .limit(HISTORY_MAX);
  return { variant, movements };
}

export type AdjustStockResult =
  | { ok: true; stock: number }
  | { ok: false; error: "notFound" | "untracked" | "stale" | "invalid" };

/**
 * A manual stock change, in one transaction: lock the variant (like checkout, so an order
 * cannot slip in between), refuse `stale` when its stock is no longer `expectedStock` (what
 * the merchant saw), apply the change and write the movement. Receiving units with a unit
 * cost (in the base currency) sets the variant's cost to the weighted average.
 */
export async function adjustStock(
  scope: Scope,
  input: {
    variantId: string;
    expectedStock: number;
    mode: AdjustMode;
    reason: InventoryReason;
    quantity: number;
    unitCostMinor: number | null;
    baseCurrencyCode: string;
    note: string | null;
    userId: string;
  },
): Promise<AdjustStockResult> {
  return db.transaction(async (tx) => {
    const [variant] = await tx
      .select({ stock: productVariant.stock, costMinor: productVariant.costMinor, costCurrencyCode: productVariant.costCurrencyCode })
      .from(productVariant)
      .where(and(variantInScope(scope), eq(productVariant.id, input.variantId)))
      .for("no key update");
    if (!variant) return { ok: false, error: "notFound" };
    if (variant.stock === null) return { ok: false, error: "untracked" };
    if (variant.stock !== input.expectedStock) return { ok: false, error: "stale" };
    const next = stockAfter(variant.stock, input.mode, input.quantity);
    if (next === null) return { ok: false, error: "invalid" };

    // Received with a cost: average it with the stock on hand (only when both are in the base currency)
    const cost =
      input.reason === "received" && input.unitCostMinor !== null
        ? averageCost(
            variant.stock,
            variant.costCurrencyCode === input.baseCurrencyCode ? variant.costMinor : null,
            next - variant.stock,
            input.unitCostMinor,
          )
        : null;
    await tx
      .update(productVariant)
      .set({ stock: next, ...(cost !== null ? { costMinor: cost, costCurrencyCode: input.baseCurrencyCode } : {}) })
      .where(and(variantInScope(scope), eq(productVariant.id, input.variantId)));
    await recordMovements(tx, scope, [
      {
        variantId: input.variantId,
        reason: input.reason,
        delta: next - variant.stock,
        stockAfter: next,
        actorUserId: input.userId,
        cost:
          input.reason === "received" && input.unitCostMinor !== null
            ? { minor: input.unitCostMinor, currencyCode: input.baseCurrencyCode }
            : null,
        note: input.note,
      },
    ]);
    return { ok: true, stock: next };
  });
}

/** Sets (or clears, with null) a variant's unit cost, in the base currency. false = not found. */
export async function setVariantCost(
  scope: Scope,
  variantId: string,
  costMinor: number | null,
  baseCurrencyCode: string,
): Promise<boolean> {
  const rows = await db
    .update(productVariant)
    .set({ costMinor, costCurrencyCode: costMinor === null ? null : baseCurrencyCode })
    .where(and(variantInScope(scope), eq(productVariant.id, variantId)))
    .returning({ id: productVariant.id });
  return rows.length === 1;
}
