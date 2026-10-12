import { z } from "zod";
import { parsePriceToMinor } from "@/lib/money";
import { PAYMENT_KINDS, PAYMENT_METHODS, type PaymentKind, type PaymentMethod } from "@/lib/orders";
import type { Translator } from "./types";

/** A few minutes of clock difference between the browser and the server are fine. */
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;

/**
 * A payment (or refund) recorded by hand, in the order's currency (`digits` decimals).
 * `paidAt` is the browser's local "YYYY-MM-DDTHH:mm" in the form, converted to ISO (UTC)
 * before it is sent; empty = now. With `limits` (the form) the amount is also checked
 * against what is owed / was collected; the server checks the same limits against the
 * locked order, so the form's copy is only for quick feedback.
 */
export function createPaymentSchema(
  t: Translator,
  digits: number,
  limits?: { dueMinor: number; netMinor: number; format: (minor: number) => string },
) {
  return z
    .object({
      kind: z.enum(PAYMENT_KINDS),
      method: z.enum(PAYMENT_METHODS),
      amount: z.string().trim(),
      paidAt: z.string().trim(),
      note: z.string().trim().max(500, t("tooLong", { max: 500 })),
    })
    .superRefine((values, ctx) => {
      const minor = parsePriceToMinor(values.amount, digits, Number.MAX_SAFE_INTEGER);
      if (!minor) {
        ctx.addIssue({
          code: "custom",
          path: ["amount"],
          message: t(digits === 0 ? "amountInvalidWhole" : "amountInvalid", { digits }),
        });
      } else if (limits) {
        const message = paymentLimitMessage(t, values.kind, minor, limits);
        if (message) ctx.addIssue({ code: "custom", path: ["amount"], message });
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
export type PaymentFormValues = z.infer<ReturnType<typeof createPaymentSchema>>;

/** A payment can be at most what is still owed; a refund at most what was collected. */
export function paymentLimitMessage(
  t: Translator,
  kind: PaymentKind,
  amountMinor: number,
  limits: { dueMinor: number; netMinor: number; format: (minor: number) => string },
): string | null {
  if (kind === "payment" && amountMinor > limits.dueMinor) {
    return t("paymentExceedsDue", { amount: limits.format(limits.dueMinor) });
  }
  if (kind === "refund" && amountMinor > limits.netMinor) {
    return t("refundExceedsPaid", { amount: limits.format(limits.netMinor) });
  }
  return null;
}

export type PaymentInput = {
  kind: PaymentKind;
  method: PaymentMethod;
  amountMinor: number;
  /** null = now */
  paidAt: Date | null;
  note: string;
};

/** Validated form values -> what the server stores. */
export function toPaymentInput(values: PaymentFormValues, digits: number): PaymentInput {
  return {
    kind: values.kind,
    method: values.method,
    amountMinor: parsePriceToMinor(values.amount, digits, Number.MAX_SAFE_INTEGER)!,
    paidAt: values.paidAt ? new Date(values.paidAt) : null,
    note: values.note,
  };
}
