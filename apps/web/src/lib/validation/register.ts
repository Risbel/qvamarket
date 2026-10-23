import { z } from "zod";
import { parsePriceToMinor } from "@/lib/money";
import { REGISTER_MOVEMENT_KINDS, REGISTER_NOTE_MAX } from "@/lib/register";
import type { Translator } from "./types";

// Cash register forms (open, cash in / out, close). Amounts are decimal strings in each
// currency's digits; the same schemas run again on the server. `currencies` = the store's.

type Currency = { code: string; digits: number };

const amountOf = (value: string, digits: number) => parsePriceToMinor(value.trim() === "" ? "0" : value, digits, Number.MAX_SAFE_INTEGER);
const amountMessage = (t: Translator, digits: number) => t(digits === 0 ? "amountInvalidWhole" : "amountInvalid", { digits });
const note = (t: Translator) => z.string().trim().max(REGISTER_NOTE_MAX, t("tooLong", { max: REGISTER_NOTE_MAX }));

/** One amount per currency, keyed by code (an empty field = 0, unless `required`). */
function perCurrency(t: Translator, currencies: Currency[], required = false) {
  return z.record(z.string(), z.string()).superRefine((values, ctx) => {
    for (const c of currencies) {
      if (required && !(values[c.code] ?? "").trim()) {
        ctx.addIssue({ code: "custom", path: [c.code], message: t("required") });
      } else if (amountOf(values[c.code] ?? "", c.digits) === null) {
        ctx.addIssue({ code: "custom", path: [c.code], message: amountMessage(t, c.digits) });
      }
    }
  });
}

/** Values -> minor units per currency (only the store's currencies). */
export function toMinorPerCurrency(values: Record<string, string>, currencies: Currency[]): Record<string, number> {
  return Object.fromEntries(currencies.map((c) => [c.code, amountOf(values[c.code] ?? "", c.digits) ?? 0]));
}

/** Opening: the float in the drawer per currency. */
export function createOpenRegisterSchema(t: Translator, currencies: Currency[]) {
  return z.object({ floats: perCurrency(t, currencies), note: note(t) });
}
export type OpenRegisterValues = z.infer<ReturnType<typeof createOpenRegisterSchema>>;

/** Cash put into or taken out of the drawer: positive amount, currency of the store, a reason. */
export function createMovementSchema(t: Translator, currencies: Currency[]) {
  return z
    .object({
      kind: z.enum(REGISTER_MOVEMENT_KINDS),
      currencyCode: z.string(),
      amount: z.string().trim(),
      note: z.string().trim().min(1, t("required")).max(REGISTER_NOTE_MAX, t("tooLong", { max: REGISTER_NOTE_MAX })),
    })
    .superRefine((values, ctx) => {
      const currency = currencies.find((c) => c.code === values.currencyCode);
      if (!currency) return ctx.addIssue({ code: "custom", path: ["currencyCode"], message: t("currencyRequired") });
      if (!parsePriceToMinor(values.amount, currency.digits, Number.MAX_SAFE_INTEGER)) {
        ctx.addIssue({ code: "custom", path: ["amount"], message: amountMessage(t, currency.digits) });
      }
    });
}
export type MovementValues = z.infer<ReturnType<typeof createMovementSchema>>;

/**
 * Close: the cash counted per currency of the shift (`currencies` = the shift's drawers), the
 * expected amounts a supervisor saw (`shown`; the server refuses if they changed; a cashier
 * counts blind and sends none), and a note, required when a count differs from what was
 * expected (checked here only when `expected` is known; the server always checks).
 */
export function createCloseRegisterSchema(t: Translator, currencies: Currency[], expected?: Record<string, number>) {
  return z
    .object({
      // a count is always typed: an empty field is not "0 in the drawer"
      counted: perCurrency(t, currencies, true),
      shown: z.record(z.string(), z.number().int()).optional(),
      note: note(t),
    })
    .superRefine((values, ctx) => {
      if (!expected || values.note) return;
      const differs = currencies.some((c) => amountOf(values.counted[c.code] ?? "", c.digits) !== expected[c.code]);
      if (differs) ctx.addIssue({ code: "custom", path: ["note"], message: t("registerNoteRequired") });
    });
}
export type CloseRegisterValues = z.infer<ReturnType<typeof createCloseRegisterSchema>>;
