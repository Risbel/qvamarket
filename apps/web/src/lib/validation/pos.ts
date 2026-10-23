import { z } from "zod";
import { findPhoneCountry } from "@/lib/countries";
import { formatMoney, parsePriceToMinor } from "@/lib/money";
import { PAYMENT_METHODS } from "@/lib/orders";
import { normalizePhone } from "@/lib/phone";
import { POS_MAX_LINES, POS_MAX_PAYMENTS, POS_MAX_QUANTITY, POS_NOTE_MAX, POS_REFERENCE_MAX } from "@/lib/pos";
import { phoneCountrySchema } from "./checkout";
import type { Translator } from "./types";

// Counter sale (POS): the charge form (payments, optional customer, note) and the whole sale
// the server receives (the ticket plus that form). Amounts are decimal strings in the sale's
// currency; the server converts them and prices the ticket itself.

const amountOf = (value: string, digits: number) => parsePriceToMinor(value, digits, Number.MAX_SAFE_INTEGER);
const amountMessage = (t: Translator, digits: number) => t(digits === 0 ? "amountInvalidWhole" : "amountInvalid", { digits });

const chargeFields = (t: Translator) => ({
  payments: z
    .array(
      z.object({
        method: z.enum(PAYMENT_METHODS),
        amount: z.string().trim(),
        reference: z.string().trim().max(POS_REFERENCE_MAX, t("tooLong", { max: POS_REFERENCE_MAX })),
      }),
    )
    .max(POS_MAX_PAYMENTS),
  /** what is still owed stays pending ("charge later", e.g. a transfer not confirmed yet) */
  payLater: z.boolean(),
  customerName: z.string().trim().max(100, t("tooLong", { max: 100 })),
  customerPhone: z.string().trim().max(40, t("tooLong", { max: 40 })),
  phoneCountry: phoneCountrySchema,
  note: z.string().trim().max(POS_NOTE_MAX, t("tooLong", { max: POS_NOTE_MAX })),
});

type ChargeValues = z.infer<z.ZodObject<ReturnType<typeof chargeFields>>>;

/** Checks shared by the form and the server; returns the payments in minor units. */
function checkCharge(t: Translator, values: ChargeValues, digits: number, ctx: z.RefinementCtx): number[] {
  const amounts = values.payments.map((payment, index) => {
    const minor = amountOf(payment.amount, digits);
    if (!minor) ctx.addIssue({ code: "custom", path: ["payments", index, "amount"], message: amountMessage(t, digits) });
    return minor ?? 0;
  });
  if (values.customerPhone && normalizePhone(values.customerPhone, findPhoneCountry(values.phoneCountry)) === null) {
    ctx.addIssue({ code: "custom", path: ["customerPhone"], message: t("phoneInvalid") });
  }
  if (values.customerPhone && !values.customerName) {
    ctx.addIssue({ code: "custom", path: ["customerName"], message: t("posNameForPhone") });
  }
  return amounts;
}

/**
 * The charge form for a ticket of `totalMinor`. `received` = cash handed over (only for the
 * change; empty = exact). The payments may not add up to more than the total, and less only
 * with "charge later".
 */
export function createPosChargeSchema(t: Translator, currency: string, digits: number, totalMinor: number, locale: string) {
  return z.object({ ...chargeFields(t), received: z.string().trim() }).superRefine((values, ctx) => {
    const amounts = checkCharge(t, values, digits, ctx);
    const paid = amounts.reduce((sum, a) => sum + a, 0);
    if (paid > totalMinor) {
      ctx.addIssue({ code: "custom", path: ["payments"], message: t("posPaidTooMuch", { amount: formatMoney(totalMinor, currency, locale) }) });
    } else if (paid < totalMinor && !values.payLater) {
      ctx.addIssue({ code: "custom", path: ["payLater"], message: t("posPaidTooLittle") });
    }
    const cash = values.payments.reduce((sum, p, i) => sum + (p.method === "cash" ? amounts[i] : 0), 0);
    if (values.received) {
      const received = amountOf(values.received, digits);
      if (!received) ctx.addIssue({ code: "custom", path: ["received"], message: amountMessage(t, digits) });
      else if (received < cash) ctx.addIssue({ code: "custom", path: ["received"], message: t("posReceivedTooLittle") });
    }
  });
}
export type PosChargeValues = z.infer<ReturnType<typeof createPosChargeSchema>>;

/** The whole sale as the server receives it (the total is the server's own pricing). */
export function createPosSaleSchema(t: Translator, currencies: { code: string; digits: number }[]) {
  return z
    .object({
      ...chargeFields(t),
      currencyCode: z.string(),
      items: z
        .array(z.object({ variantId: z.uuid(), quantity: z.number().int().min(1).max(POS_MAX_QUANTITY) }))
        .min(1)
        .max(POS_MAX_LINES),
      /** the total the cashier saw (compared, never used as an amount) */
      expectedTotalMinor: z.number().int().min(0),
      idempotencyKey: z.uuid(),
    })
    .superRefine((values, ctx) => {
      const currency = currencies.find((c) => c.code === values.currencyCode);
      if (!currency) return ctx.addIssue({ code: "custom", path: ["currencyCode"], message: t("currencyRequired") });
      checkCharge(t, values, currency.digits, ctx);
      if (new Set(values.items.map((i) => i.variantId)).size !== values.items.length) {
        ctx.addIssue({ code: "custom", path: ["items"], message: t("quantityInvalid") });
      }
    });
}
export type PosSaleValues = z.infer<ReturnType<typeof createPosSaleSchema>>;
