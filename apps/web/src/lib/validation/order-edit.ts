import { z } from "zod";
import type { Translator } from "./types";

/** Matches the cart's cap (99 units per line), with room for older orders. */
const MAX_LINE_QUANTITY = 9999;

/**
 * An edit of an order's items: every line the merchant saw, with the quantity it had
 * (`from`, so the server refuses a page that is out of date) and the new one (`to`, never
 * more: an edit only lowers or removes). `restock` = give the removed units back to the
 * product's stock (the customer changed their mind); off when the product was not really
 * there. At least one line must change, and one must stay (removing everything = cancel).
 */
export function createOrderEditSchema(t: Translator) {
  return z
    .object({
      lines: z
        .array(
          z.object({
            itemId: z.uuid(),
            from: z.int().min(1).max(MAX_LINE_QUANTITY),
            to: z.int().min(0).max(MAX_LINE_QUANTITY),
            restock: z.boolean(),
          }),
        )
        .min(1)
        .max(50),
      note: z.string().trim().max(500, t("tooLong", { max: 500 })),
    })
    .superRefine((values, ctx) => {
      values.lines.forEach((line, index) => {
        if (line.to > line.from) {
          ctx.addIssue({ code: "custom", path: ["lines", index, "to"], message: t("orderEditMore", { max: line.from }) });
        }
      });
      if (new Set(values.lines.map((line) => line.itemId)).size !== values.lines.length) {
        ctx.addIssue({ code: "custom", path: ["lines"], message: t("orderEditNoChange") });
      } else if (values.lines.every((line) => line.to === line.from)) {
        ctx.addIssue({ code: "custom", path: ["lines"], message: t("orderEditNoChange") });
      } else if (values.lines.every((line) => line.to === 0)) {
        ctx.addIssue({ code: "custom", path: ["lines"], message: t("orderEditEmpty") });
      }
    });
}
export type OrderEditValues = z.infer<ReturnType<typeof createOrderEditSchema>>;
