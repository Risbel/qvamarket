"use server";

import { headers } from "next/headers";
import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { routing } from "@/i18n/routing";
import { sanitizeCartItems } from "@/lib/cart";
import { findPhoneCountry } from "@/lib/countries";
import { normalizePhone } from "@/lib/phone";
import { createCheckoutSchema } from "@/lib/validation/checkout";
import { placeOrder } from "./checkout";
import { getPublicStoreBySlug } from "./public-store";
import { createRateLimiter } from "./rate-limit";
import { clientIp } from "./request";
import { pickCurrency } from "./storefront-currency";

// Every order takes stock: limit how many one IP can place (fake orders would empty a store).
// Retries of the same attempt (same idempotency key) do not create orders but still count.
const limiter = createRateLimiter({ limit: 10, windowMs: 10 * 60 * 1000 });

const requestSchema = z.object({
  slug: z.string().min(1).max(63),
  currency: z.string().regex(/^[A-Z]{3}$/),
  expectedSubtotalMinor: z.number().int().nonnegative(),
  idempotencyKey: z.uuid(),
});

export type PlaceOrderActionResult =
  | { ok: true; orderId: string }
  | {
      ok: false;
      error: "invalid" | "notFound" | "empty" | "cartChanged" | "tooManyRequests" | "failed";
      fieldErrors?: Record<string, string[]>;
    };

/**
 * Checkout (pickup). The browser sends which store (slug, looked up), the currency the
 * customer saw, the cart (ids + quantities, re-validated), the subtotal it showed (compared,
 * never used as an amount), a random key for this attempt, and the contact form.
 */
export async function placeOrderAction(
  request: unknown,
  items: unknown,
  values: unknown,
  locale: string,
): Promise<PlaceOrderActionResult> {
  if (!limiter.tryConsume(clientIp(await headers()))) return { ok: false, error: "tooManyRequests" };

  const parsedRequest = requestSchema.safeParse(request);
  if (!parsedRequest.success) return { ok: false, error: "invalid" };
  const { slug, currency, expectedSubtotalMinor, idempotencyKey } = parsedRequest.data;

  const t = await getTranslations({
    locale: hasLocale(routing.locales, locale) ? locale : routing.defaultLocale,
    namespace: "Validation",
  });
  const parsed = createCheckoutSchema(t).safeParse(values);
  if (!parsed.success) {
    return {
      ok: false,
      error: "invalid",
      fieldErrors: z.flattenError(parsed.error).fieldErrors as Record<string, string[]>,
    };
  }

  const store = await getPublicStoreBySlug(slug);
  if (!store) return { ok: false, error: "notFound" };
  // The currency must still be one of the store's; otherwise the customer saw other prices
  const chosen = pickCurrency(store.currencies, currency);
  if (chosen.code !== currency) return { ok: false, error: "cartChanged" };

  try {
    const result = await placeOrder({
      storeId: store.id,
      currencyCode: chosen.code,
      items: sanitizeCartItems(items),
      expectedSubtotalMinor,
      idempotencyKey: idempotencyKey.toLowerCase(),
      contact: {
        name: parsed.data.name,
        phone: normalizePhone(parsed.data.phone, findPhoneCountry(parsed.data.phoneCountry))!,
        email: parsed.data.email === "" ? null : parsed.data.email.toLowerCase(),
        note: parsed.data.note === "" ? null : parsed.data.note,
      },
    });
    if (result.ok) return result;
    return { ok: false, error: result.error === "storeClosed" ? "notFound" : result.error };
  } catch (error) {
    console.error("checkout failed", error);
    return { ok: false, error: "failed" };
  }
}
