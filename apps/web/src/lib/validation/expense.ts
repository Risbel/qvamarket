import { z } from "zod";
import { EXPENSE_CATEGORIES, EXPENSE_NOTE_MAX, EXPENSE_PAYEE_MAX } from "@/lib/expenses";
import { parsePriceToMinor } from "@/lib/money";
import { PAYMENT_METHODS } from "@/lib/orders";
import type { Translator } from "./types";

/** A few minutes of clock difference between the browser and the server are fine. */
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * An expense recorded by hand. `currencies` = the store's currencies (the amount is checked
 * with the chosen one's decimals). `paidAt` is the browser's local "YYYY-MM-DDTHH:mm" in the
 * form, converted to ISO (UTC) before it is sent; empty = now. `memberUserId` ("" = none) is
 * only kept for salaries; the server checks it is a member of the company.
 */
export function createExpenseSchema(t: Translator, currencies: { code: string; digits: number }[]) {
  return z
    .object({
      category: z.enum(EXPENSE_CATEGORIES),
      amount: z.string().trim(),
      currency: z.string().refine((code) => currencies.some((c) => c.code === code), t("currencyRequired")),
      method: z.enum(PAYMENT_METHODS),
      paidAt: z.string().trim(),
      payee: z.string().trim().max(EXPENSE_PAYEE_MAX, t("tooLong", { max: EXPENSE_PAYEE_MAX })),
      memberUserId: z.string().refine((value) => value === "" || UUID.test(value)),
      note: z.string().trim().max(EXPENSE_NOTE_MAX, t("tooLong", { max: EXPENSE_NOTE_MAX })),
    })
    .superRefine((values, ctx) => {
      const digits = currencies.find((c) => c.code === values.currency)?.digits ?? 2;
      if (!parsePriceToMinor(values.amount, digits, Number.MAX_SAFE_INTEGER)) {
        ctx.addIssue({
          code: "custom",
          path: ["amount"],
          message: t(digits === 0 ? "amountInvalidWhole" : "amountInvalid", { digits }),
        });
      }
      if (values.paidAt) {
        const time = Date.parse(values.paidAt);
        if (Number.isNaN(time)) ctx.addIssue({ code: "custom", path: ["paidAt"], message: t("dateInvalid") });
        else if (time > Date.now() + FUTURE_TOLERANCE_MS) {
          ctx.addIssue({ code: "custom", path: ["paidAt"], message: t("dateInFuture") });
        }
      }
    });
}
export type ExpenseFormValues = z.infer<ReturnType<typeof createExpenseSchema>>;

export type ExpenseInput = {
  category: ExpenseFormValues["category"];
  amountMinor: number;
  currencyCode: string;
  method: ExpenseFormValues["method"];
  paidAt: Date;
  payee: string | null;
  memberUserId: string | null;
  note: string | null;
};

/** Validated form values -> database values (minor units, nulls for empty fields). */
export function toExpenseInput(values: ExpenseFormValues, currencies: { code: string; digits: number }[]): ExpenseInput {
  const digits = currencies.find((c) => c.code === values.currency)?.digits ?? 2;
  const amountMinor = parsePriceToMinor(values.amount, digits, Number.MAX_SAFE_INTEGER);
  if (!amountMinor) throw new Error("amount was not validated");
  return {
    category: values.category,
    amountMinor,
    currencyCode: values.currency,
    method: values.method,
    paidAt: values.paidAt ? new Date(values.paidAt) : new Date(),
    payee: values.payee || null,
    memberUserId: values.category === "salaries" && values.memberUserId ? values.memberUserId.toLowerCase() : null,
    note: values.note || null,
  };
}
