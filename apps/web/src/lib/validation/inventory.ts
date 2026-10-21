import { z } from "zod";
import { ADJUST_MODES, ADJUST_NOTE_MAX, isManualReason, stockAfter } from "@/lib/inventory";
import { parsePriceToMinor } from "@/lib/money";
import { MAX_STOCK } from "./product";
import type { Translator } from "./types";

/** "" = unknown cost; otherwise a price in the base currency (`digits` decimals). */
const costField = (t: Translator, digits: number) =>
  z
    .string()
    .trim()
    .refine(
      (value) => value === "" || parsePriceToMinor(value, digits) !== null,
      t(digits === 0 ? "priceInvalidWhole" : "priceInvalid", { digits }),
    );

/**
 * A manual stock change of one tracked variant: add units, take units out or set the count,
 * with a reason (MANUAL_REASONS of the mode) and an optional note. `stock` is the stock the
 * form shows; the server checks it again against the locked row (`stale` if it moved). The
 * unit cost is only read for `received` (it updates the variant's average cost).
 */
export function createStockAdjustmentSchema(t: Translator, { stock, digits }: { stock: number; digits: number }) {
  return z
    .object({
      mode: z.enum(ADJUST_MODES),
      reason: z.string(),
      quantity: z.string().trim(),
      unitCost: costField(t, digits),
      note: z.string().trim().max(ADJUST_NOTE_MAX, t("tooLong", { max: ADJUST_NOTE_MAX })),
    })
    .superRefine((values, ctx) => {
      if (!isManualReason(values.mode, values.reason)) {
        ctx.addIssue({ code: "custom", path: ["reason"], message: t("required") });
      }
      const quantity = /^\d{1,10}$/.test(values.quantity) ? Number(values.quantity) : null;
      if (quantity === null || quantity > MAX_STOCK || (values.mode !== "set" && quantity === 0)) {
        ctx.addIssue({ code: "custom", path: ["quantity"], message: t("quantityInvalid") });
      } else if (stockAfter(stock, values.mode, quantity) === null) {
        const message =
          values.mode === "set" && quantity === stock
            ? t("stockNoChange")
            : values.mode === "remove"
              ? t("stockBelowZero", { stock })
              : t("stockInvalid");
        ctx.addIssue({ code: "custom", path: ["quantity"], message });
      }
    });
}
export type StockAdjustmentValues = z.infer<ReturnType<typeof createStockAdjustmentSchema>>;

/** A variant's unit cost in the base currency ("" = unknown). */
export function createCostSchema(t: Translator, digits: number) {
  return z.object({ cost: costField(t, digits) });
}
export type CostValues = z.infer<ReturnType<typeof createCostSchema>>;
