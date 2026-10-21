import type { INVENTORY_REASONS as DB_INVENTORY_REASONS } from "@qvashop/db/schema";
import { convertMinor, type FxCurrency } from "./exchange";
import { MAX_STOCK } from "./validation/product";

// Inventory rules (pure, client-safe): why stock moves, what the merchant may choose by
// hand, the weighted average cost and the value of the stock.

/** Client-safe copy of the database list (`satisfies` keeps them identical). */
export const INVENTORY_REASONS = [
  "initial",
  "received",
  "sale",
  "cancel",
  "order_edit",
  "adjustment",
  "damaged",
  "gift",
  "return",
  "other",
] as const satisfies typeof DB_INVENTORY_REASONS;
export type InventoryReason = (typeof INVENTORY_REASONS)[number];

/** How the merchant changes the stock by hand: add units, take units out, or set the count. */
export const ADJUST_MODES = ["add", "remove", "set"] as const;
export type AdjustMode = (typeof ADJUST_MODES)[number];

/** Reasons offered per mode (the first is preselected). Orders write the others. */
export const MANUAL_REASONS = {
  add: ["received", "return", "other"],
  remove: ["damaged", "gift", "other"],
  set: ["adjustment"],
} as const satisfies Record<AdjustMode, readonly InventoryReason[]>;

export function isManualReason(mode: AdjustMode, reason: string): reason is InventoryReason {
  return (MANUAL_REASONS[mode] as readonly string[]).includes(reason);
}

/** Stock at or under this is "low" (the storefront says "only N left" up to the same number). */
export const LOW_STOCK = 5;
/** Movements shown on a variant's history page. */
export const HISTORY_MAX = 100;
export const ADJUST_NOTE_MAX = 300;

/**
 * The stock after a manual change, or null when it would be negative, too large or no change
 * at all (`quantity` is what the merchant typed: units to add or remove, or the new count).
 */
export function stockAfter(current: number, mode: AdjustMode, quantity: number): number | null {
  const next = mode === "add" ? current + quantity : mode === "remove" ? current - quantity : quantity;
  if (next < 0 || next > MAX_STOCK || next === current) return null;
  return next;
}

export type FormStockChange =
  | { kind: "keep" }
  | { kind: "stale" }
  | { kind: "set"; stock: number | null; delta: number; reason: "initial" | "adjustment" };

/**
 * A stock typed in the product form or the variants editor (`loaded` = what the form showed,
 * `current` = the locked row now). Untouched field = keep the stock as it is (an order taken
 * meanwhile stays taken); a changed field over a stock that moved meanwhile = `stale`;
 * otherwise set it: `initial` when tracking starts, `adjustment` for a new count (delta 0 =
 * no movement, e.g. tracking turned off).
 */
export function formStockChange(current: number | null, loaded: number | null, typed: number | null): FormStockChange {
  if (typed === loaded) return { kind: "keep" };
  if (current !== loaded) return { kind: "stale" };
  if (typed === null) return { kind: "set", stock: null, delta: 0, reason: "adjustment" };
  if (current === null) return { kind: "set", stock: typed, delta: typed, reason: "initial" };
  return { kind: "set", stock: typed, delta: typed - current, reason: "adjustment" };
}

/**
 * Weighted average cost after receiving `quantity` units at `unitCostMinor`: what the stock
 * on hand cost plus what arrived, over the units after it. Without a known cost for the stock
 * on hand (or nothing on hand) the new cost is simply the received one. Rounded half up.
 */
export function averageCost(
  stock: number,
  currentCostMinor: number | null,
  quantity: number,
  unitCostMinor: number,
): number {
  if (currentCostMinor === null || stock <= 0) return unitCostMinor;
  const total = BigInt(stock) * BigInt(currentCostMinor) + BigInt(quantity) * BigInt(unitCostMinor);
  const units = BigInt(stock + quantity);
  return Number((total * BigInt(2) + units) / (units * BigInt(2)));
}

/** Value of the stock on hand (stock x cost), or null when untracked or the cost is unknown. */
export function inventoryValue(stock: number | null, costMinor: number | null): number | null {
  if (stock === null || costMinor === null) return null;
  return stock * costMinor;
}

/**
 * A variant's unit cost expressed in `targetCode` (an order's currency): as stored when it is
 * the same currency, converted at the store's rate when the cost is in the base currency
 * (no rounding step: a cost is not a shelf price). Null when unknown or not convertible.
 */
export function costIn(
  cost: { minor: number; currencyCode: string } | null,
  targetCode: string,
  currencies: (FxCurrency & { code: string })[],
): number | null {
  if (cost === null) return null;
  if (cost.currencyCode === targetCode) return cost.minor;
  const base = currencies.find((c) => c.isBase);
  const target = currencies.find((c) => c.code === targetCode);
  if (!base || !target || base.code !== cost.currencyCode) return null;
  return convertMinor(cost.minor, base, { ...target, roundingMinor: null });
}
