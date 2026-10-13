import { z } from "zod";
import { findPhoneCountry, isPhoneCountryCode } from "@/lib/countries";
import { normalizePhone } from "@/lib/phone";
import type { Translator } from "./types";

/** "" (no country) or a supported country code. */
// `: boolean` on purpose: an inferred type predicate would narrow the form's type to the codes
export const phoneCountrySchema = z.string().refine((code): boolean => code === "" || isPhoneCountryCode(code));

export const FULFILLMENT_TYPES = ["pickup", "delivery"] as const;

/**
 * Contact details at checkout, and how the order reaches the customer: pickup, or home
 * delivery to a pin on the map (`location`) plus the address as typed (street, number,
 * references; required). Whether the pin is inside the area and the fee are checked by the
 * server against the store's settings. The phone is how the merchant reaches
 * the customer and how the customer record is found again; the server normalizes it with
 * normalizePhone(phone, country) before storing it, so "5 435 3930" with Cuba and
 * "+53 54353930" are the same customer.
 */
export function createCheckoutSchema(t: Translator) {
  return z
    .object({
      name: z.string().trim().min(1, t("required")).max(100, t("tooLong", { max: 100 })),
      phoneCountry: phoneCountrySchema,
      phone: z.string().trim().min(1, t("required")),
      email: z.union([z.literal(""), z.email(t("emailInvalid")).max(200, t("tooLong", { max: 200 }))]),
      note: z.string().trim().max(500, t("tooLong", { max: 500 })),
      fulfillment: z.enum(FULFILLMENT_TYPES),
      address: z.string().trim().max(300, t("tooLong", { max: 300 })),
      location: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).nullable(),
    })
    .superRefine((values, ctx) => {
      if (values.fulfillment === "delivery") {
        if (!values.address) ctx.addIssue({ code: "custom", path: ["address"], message: t("required") });
        if (!values.location) ctx.addIssue({ code: "custom", path: ["location"], message: t("deliveryPinRequired") });
      }
      if (values.phone && normalizePhone(values.phone, findPhoneCountry(values.phoneCountry)) === null) {
        ctx.addIssue({ code: "custom", path: ["phone"], message: t("phoneInvalid") });
      }
    });
}
export type CheckoutValues = z.infer<ReturnType<typeof createCheckoutSchema>>;
