import { z } from "zod";
import { BILLING_CYCLES, BILLING_PAYMENT_METHODS, MAX_DUE_DAYS, MAX_PAUSE_DAYS } from "@/lib/billing";
import { currencyDigits, parsePriceToMinor } from "@/lib/money";
import { PLAN_KEYS } from "@/lib/plans";
import type { Translator } from "./types";

// Superadmin billing forms. Dates come from <DateTimePicker> (the browser's local
// "YYYY-MM-DDTHH:mm"), converted to ISO before they are sent; the same schemas run again on
// the server.

const NOTE_MAX = 500;
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;
const DAY_MS = 86_400_000;

const note = (t: Translator) => z.string().trim().max(NOTE_MAX, t("tooLong", { max: NOTE_MAX }));
const currencyCode = z.string().regex(/^[A-Z]{3}$/);

function checkDate(
  t: Translator,
  ctx: z.RefinementCtx,
  path: string,
  value: string,
  rule: { required?: boolean; notFuture?: boolean; future?: boolean; maxDaysAhead?: number } = {},
) {
  if (!value) {
    if (rule.required) ctx.addIssue({ code: "custom", path: [path], message: t("required") });
    return;
  }
  const time = Date.parse(value);
  if (Number.isNaN(time)) return ctx.addIssue({ code: "custom", path: [path], message: t("dateInvalid") });
  if (rule.notFuture && time > Date.now() + FUTURE_TOLERANCE_MS) {
    ctx.addIssue({ code: "custom", path: [path], message: t("dateInFuture") });
  }
  if (rule.future && time <= Date.now()) ctx.addIssue({ code: "custom", path: [path], message: t("dateInPast") });
  if (rule.maxDaysAhead !== undefined && time > Date.now() + rule.maxDaysAhead * DAY_MS) {
    ctx.addIssue({ code: "custom", path: [path], message: t("dateTooFar", { days: rule.maxDaysAhead }) });
  }
}

/**
 * Change a company's plan. `timing` only matters for a downgrade during a paid period: at its
 * end (`periodEnd`) or now (a new period starts, nothing is refunded). `startsAt` (empty = now)
 * is when a new period starts; `dueDays` how long its invoice gives to pay.
 */
export function createChangePlanSchema(t: Translator) {
  return z
    .object({
      planKey: z.enum(PLAN_KEYS),
      cycle: z.enum(BILLING_CYCLES),
      currencyCode,
      timing: z.enum(["now", "periodEnd"]),
      startsAt: z.string().trim(),
      dueDays: z
        .number({ error: t("dueDaysInvalid", { max: MAX_DUE_DAYS }) })
        .int(t("dueDaysInvalid", { max: MAX_DUE_DAYS }))
        .min(0, t("dueDaysInvalid", { max: MAX_DUE_DAYS }))
        .max(MAX_DUE_DAYS, t("dueDaysInvalid", { max: MAX_DUE_DAYS })),
      note: note(t),
    })
    .superRefine((values, ctx) => checkDate(t, ctx, "startsAt", values.startsAt));
}
export type ChangePlanValues = z.infer<ReturnType<typeof createChangePlanSchema>>;

/** A payment or refund of an invoice, in the invoice's currency (`digits` decimals). */
export function createBillingPaymentSchema(t: Translator, digits: number) {
  return z
    .object({
      kind: z.enum(["payment", "refund"]),
      method: z.enum(BILLING_PAYMENT_METHODS),
      amount: z.string().trim(),
      reference: z.string().trim().max(100, t("tooLong", { max: 100 })),
      paidAt: z.string().trim(),
      note: note(t),
    })
    .superRefine((values, ctx) => {
      if (!parsePriceToMinor(values.amount, digits, Number.MAX_SAFE_INTEGER)) {
        ctx.addIssue({
          code: "custom",
          path: ["amount"],
          message: t(digits === 0 ? "amountInvalidWhole" : "amountInvalid", { digits }),
        });
      }
      checkDate(t, ctx, "paidAt", values.paidAt, { notFuture: true });
    });
}
export type BillingPaymentValues = z.infer<ReturnType<typeof createBillingPaymentSchema>>;

/** An invoice the superadmin bills by hand (setup help, a correction...). */
export function createManualInvoiceSchema(t: Translator, digits: number) {
  return z
    .object({
      currencyCode,
      amount: z.string().trim(),
      dueAt: z.string().trim(),
      note: z.string().trim().min(1, t("required")).max(NOTE_MAX, t("tooLong", { max: NOTE_MAX })),
    })
    .superRefine((values, ctx) => {
      if (!parsePriceToMinor(values.amount, digits, Number.MAX_SAFE_INTEGER)) {
        ctx.addIssue({
          code: "custom",
          path: ["amount"],
          message: t(digits === 0 ? "amountInvalidWhole" : "amountInvalid", { digits }),
        });
      }
      checkDate(t, ctx, "dueAt", values.dueAt);
    });
}
export type ManualInvoiceValues = z.infer<ReturnType<typeof createManualInvoiceSchema>>;

export function createVoidInvoiceSchema(t: Translator) {
  return z.object({ reason: z.string().trim().min(1, t("required")).max(300, t("tooLong", { max: 300 })) });
}

/** Pause: the stores stop being public and nothing is billed. Empty `resumesAt` = until resumed by hand. */
export function createPauseSchema(t: Translator) {
  return z
    .object({ resumesAt: z.string().trim(), note: note(t) })
    .superRefine((values, ctx) =>
      checkDate(t, ctx, "resumesAt", values.resumesAt, { future: true, maxDaysAhead: MAX_PAUSE_DAYS }),
    );
}

/** A correction of the paid-until date or of the trial end. */
export function createAdjustDateSchema(t: Translator) {
  return z
    .object({ date: z.string().trim(), note: z.string().trim().min(1, t("required")).max(NOTE_MAX, t("tooLong", { max: NOTE_MAX })) })
    .superRefine((values, ctx) => checkDate(t, ctx, "date", values.date, { required: true }));
}

export function createNoteSchema(t: Translator) {
  return z.object({ note: note(t) });
}

/** A plan's price for a cycle and currency (0 is allowed, e.g. a promotional plan). */
export function createPlanPriceSchema(t: Translator) {
  return z
    .object({
      planKey: z.enum(PLAN_KEYS).exclude(["free"]),
      cycle: z.enum(BILLING_CYCLES),
      currencyCode,
      amount: z.string().trim(),
      isActive: z.boolean(),
    })
    .superRefine((values, ctx) => {
      const digits = currencyDigits(values.currencyCode);
      if (values.amount.replace(/[.,]0*$/, "") !== "0" && !parsePriceToMinor(values.amount, digits, Number.MAX_SAFE_INTEGER)) {
        ctx.addIssue({
          code: "custom",
          path: ["amount"],
          message: t(digits === 0 ? "amountInvalidWhole" : "amountInvalid", { digits }),
        });
      }
    });
}
export type PlanPriceValues = z.infer<ReturnType<typeof createPlanPriceSchema>>;

/** Validated price form -> minor units (0 for a free price). */
export function planPriceMinor(values: PlanPriceValues): number {
  return parsePriceToMinor(values.amount, currencyDigits(values.currencyCode), Number.MAX_SAFE_INTEGER) ?? 0;
}
