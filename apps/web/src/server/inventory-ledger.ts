import { db, inventoryMovement } from "@qvashop/db";
import type { InventoryReason } from "@/lib/inventory";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type Movement = {
  variantId: string;
  reason: InventoryReason;
  /** signed: units in > 0, out < 0 (rows with 0 are skipped) */
  delta: number;
  stockAfter: number;
  orderId?: string | null;
  actorUserId?: string | null;
  cost?: { minor: number; currencyCode: string } | null;
  note?: string | null;
};

/**
 * Writes the movements of one stock change, inside the transaction that changes the stock
 * (every write of product_variant.stock on a tracked variant must call this).
 */
export async function recordMovements(
  tx: Tx,
  scope: { tenantId: string; storeId: string },
  movements: Movement[],
): Promise<void> {
  const rows = movements.filter((movement) => movement.delta !== 0);
  if (rows.length === 0) return;
  await tx.insert(inventoryMovement).values(
    rows.map((movement) => ({
      tenantId: scope.tenantId,
      storeId: scope.storeId,
      variantId: movement.variantId,
      reason: movement.reason,
      delta: movement.delta,
      stockAfter: movement.stockAfter,
      orderId: movement.orderId ?? null,
      actorUserId: movement.actorUserId ?? null,
      unitCostMinor: movement.cost?.minor ?? null,
      costCurrencyCode: movement.cost?.currencyCode ?? null,
      note: movement.note ?? null,
    })),
  );
}
