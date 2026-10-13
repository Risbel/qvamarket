import { z } from "zod";
import { DELIVERY_FEE_MODES, type DeliveryFeeMode } from "@/lib/delivery";
import { parsePriceToMinor } from "@/lib/money";
import type { FormCurrency } from "./product";
import type { Translator } from "./types";

/** Longest base distance accepted (km); the DB allows up to 1000 km. */
export const MAX_BASE_DISTANCE_KM = 1000;

const amount = (value: string, digits: number) => parsePriceToMinor(value, digits, Number.MAX_SAFE_INTEGER);
/** km typed with up to 3 decimals ("1.5", "1,5") -> meters, by string arithmetic */
const kmToMeters = (value: string) => (value.trim() === "" ? 0 : parsePriceToMinor(value, 3, MAX_BASE_DISTANCE_KM * 1000));

/**
 * Settings > Delivery, charges: how the order reaches the customer (pickup / delivery, at
 * least one), the fee mode and, per store currency, the amounts as typed (decimal strings):
 *  - flat / distance: the base fee is required in the default currency (distance: the per-km
 *    charge too); another currency left empty = no delivery in that currency;
 *  - "free above" and "minimum order": empty or 0 = never / none.
 */
export function createDeliveryChargesSchema(t: Translator, currencies: FormCurrency[]) {
  const digitsOf = new Map(currencies.map((c) => [c.code, c.digits]));
  const defaultCode = currencies.find((c) => c.isDefault)?.code ?? currencies[0]?.code;
  return z
    .object({
      deliveryEnabled: z.boolean(),
      pickupEnabled: z.boolean(),
      mode: z.enum(DELIVERY_FEE_MODES),
      baseDistanceKm: z.string().trim(),
      rates: z.array(
        z.object({
          currency: z.string().refine((code) => digitsOf.has(code)),
          baseFee: z.string().trim(),
          perKm: z.string().trim(),
          freeAbove: z.string().trim(),
          minOrder: z.string().trim(),
        }),
      ),
    })
    .superRefine((values, ctx) => {
      if (!values.deliveryEnabled && !values.pickupEnabled) {
        ctx.addIssue({ code: "custom", path: ["pickupEnabled"], message: t("fulfillmentRequired") });
      }
      if (values.mode === "distance" && kmToMeters(values.baseDistanceKm) === null) {
        ctx.addIssue({ code: "custom", path: ["baseDistanceKm"], message: t("distanceInvalid", { max: MAX_BASE_DISTANCE_KM }) });
      }
      const seen = new Set<string>();
      values.rates.forEach((rate, i) => {
        if (seen.has(rate.currency)) ctx.addIssue({ code: "custom", path: ["rates", i, "currency"], message: t("required") });
        seen.add(rate.currency);
        const digits = digitsOf.get(rate.currency) ?? 2;
        const invalid = t(digits === 0 ? "priceInvalidWhole" : "priceInvalid", { digits });
        const fields = values.mode === "free" ? (["minOrder"] as const) : values.mode === "flat" ? (["baseFee", "freeAbove", "minOrder"] as const) : (["baseFee", "perKm", "freeAbove", "minOrder"] as const);
        for (const field of fields) {
          if (rate[field] !== "" && amount(rate[field], digits) === null) {
            ctx.addIssue({ code: "custom", path: ["rates", i, field], message: invalid });
          }
        }
        if (values.mode === "free") return;
        // The fee itself: required in the default currency, and in any other one that is used
        const used = rate.currency === defaultCode || fields.some((field) => rate[field] !== "");
        if (used && rate.baseFee === "") ctx.addIssue({ code: "custom", path: ["rates", i, "baseFee"], message: t("deliveryFeeRequired") });
        if (used && values.mode === "distance" && rate.perKm === "") {
          ctx.addIssue({ code: "custom", path: ["rates", i, "perKm"], message: t("deliveryFeeRequired") });
        }
      });
    });
}
export type DeliveryChargesValues = z.infer<ReturnType<typeof createDeliveryChargesSchema>>;

export type DeliveryChargesInput = {
  deliveryEnabled: boolean;
  pickupEnabled: boolean;
  mode: DeliveryFeeMode;
  baseDistanceM: number;
  rates: {
    currencyCode: string;
    baseFeeMinor: number;
    perKmMinor: number;
    freeAboveMinor: number | null;
    minOrderMinor: number | null;
  }[];
};

/** Validated form values -> what the server stores (only currencies with amounts get a row). */
export function toDeliveryChargesInput(values: DeliveryChargesValues, currencies: FormCurrency[]): DeliveryChargesInput {
  const digitsOf = new Map(currencies.map((c) => [c.code, c.digits]));
  const optional = (value: string, digits: number) => {
    const minor = value === "" ? null : amount(value, digits);
    return minor ? minor : null; // 0 = never / none
  };
  const rates = values.rates.flatMap((rate) => {
    const digits = digitsOf.get(rate.currency) ?? 2;
    const minOrderMinor = optional(rate.minOrder, digits);
    if (values.mode === "free") {
      return minOrderMinor ? [{ currencyCode: rate.currency, baseFeeMinor: 0, perKmMinor: 0, freeAboveMinor: null, minOrderMinor }] : [];
    }
    if (rate.baseFee === "") return [];
    return [
      {
        currencyCode: rate.currency,
        baseFeeMinor: amount(rate.baseFee, digits)!,
        perKmMinor: values.mode === "distance" ? amount(rate.perKm, digits)! : 0,
        freeAboveMinor: optional(rate.freeAbove, digits),
        minOrderMinor,
      },
    ];
  });
  return {
    deliveryEnabled: values.deliveryEnabled,
    pickupEnabled: values.pickupEnabled,
    mode: values.mode,
    baseDistanceM: values.mode === "distance" ? kmToMeters(values.baseDistanceKm)! : 0,
    rates,
  };
}
