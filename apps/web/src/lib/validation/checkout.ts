import { z } from "zod";
import { normalizePhone } from "@/lib/phone";
import type { Translator } from "./types";

/**
 * Contact details at checkout (pickup only for now). The phone is how the merchant reaches
 * the customer and how the customer record is found again; it is normalized on the server
 * with normalizePhone() before it is stored.
 */
export function createCheckoutSchema(t: Translator) {
  return z.object({
    name: z.string().trim().min(1, t("required")).max(100, t("tooLong", { max: 100 })),
    phone: z
      .string()
      .trim()
      .min(1, t("required"))
      .refine((value) => normalizePhone(value) !== null, t("phoneInvalid")),
    email: z.union([z.literal(""), z.email(t("emailInvalid")).max(200, t("tooLong", { max: 200 }))]),
    note: z.string().trim().max(500, t("tooLong", { max: 500 })),
  });
}
export type CheckoutValues = z.infer<ReturnType<typeof createCheckoutSchema>>;
