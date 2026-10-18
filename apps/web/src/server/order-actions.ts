"use server";

import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { routing } from "@/i18n/routing";
import { currencyDigits, formatMoney } from "@/lib/money";
import { createOrderStatusSchema } from "@/lib/validation/order-status";
import { createPaymentSchema, paymentLimitMessage, toPaymentInput } from "@/lib/validation/payment";
import { deletePayment, orderCurrency, recordPayment } from "./order-payments";
import { changeOrderStatus } from "./orders";
import { getMerchantOrNull } from "./tenant";

export type OrderStatusActionResult =
  | { ok: true; restockedUnits: number }
  | {
      ok: false;
      error: "forbidden" | "notFound" | "invalid" | "stale" | "notAllowed" | "failed";
      fieldErrors?: Record<string, string[]>;
    };

const validationTranslator = (locale: string) =>
  getTranslations({ locale: hasLocale(routing.locales, locale) ? locale : routing.defaultLocale, namespace: "Validation" });

/**
 * Changes an order's status (see changeOrderStatus); needs `order:update`, or
 * `order:cancel` to cancel it (cancelling gives stock back and is final).
 */
export async function changeOrderStatusAction(
  orderId: unknown,
  values: unknown,
  locale: string,
): Promise<OrderStatusActionResult> {
  const merchant = await getMerchantOrNull();
  if (!merchant || !merchant.can({ order: ["read"] })) return { ok: false, error: "forbidden" };
  const parsedId = z.uuid().safeParse(orderId);
  if (!parsedId.success) return { ok: false, error: "notFound" };
  const t = await validationTranslator(locale);
  const parsed = createOrderStatusSchema(t).safeParse(values);
  if (!parsed.success) {
    return { ok: false, error: "invalid", fieldErrors: z.flattenError(parsed.error).fieldErrors as Record<string, string[]> };
  }
  if (!merchant.can({ order: [parsed.data.to === "cancelled" ? "cancel" : "update"] })) {
    return { ok: false, error: "forbidden" };
  }
  try {
    return await changeOrderStatus(
      { tenantId: merchant.tenantId, storeId: merchant.store.id },
      { orderId: parsedId.data.toLowerCase(), ...parsed.data, userId: merchant.session.user.id },
    );
  } catch (error) {
    console.error("changeOrderStatus failed", error);
    return { ok: false, error: "failed" };
  }
}

export type PaymentActionResult =
  | { ok: true }
  | {
      ok: false;
      error: "forbidden" | "notFound" | "invalid" | "cancelled" | "unbalanced" | "failed";
      fieldErrors?: Record<string, string[]>;
    };

/** Records a payment or refund on an order (see recordPayment); needs `payment:create`. */
export async function recordPaymentAction(orderId: unknown, values: unknown, locale: string): Promise<PaymentActionResult> {
  const merchant = await getMerchantOrNull();
  if (!merchant || !merchant.can({ order: ["read"], payment: ["create"] })) return { ok: false, error: "forbidden" };
  const parsedId = z.uuid().safeParse(orderId);
  if (!parsedId.success) return { ok: false, error: "notFound" };
  const scope = { tenantId: merchant.tenantId, storeId: merchant.store.id };
  const id = parsedId.data.toLowerCase();
  try {
    const currency = await orderCurrency(scope, id);
    if (!currency) return { ok: false, error: "notFound" };
    const t = await validationTranslator(locale);
    const digits = currencyDigits(currency);
    const parsed = createPaymentSchema(t, digits).safeParse(values);
    if (!parsed.success) {
      return { ok: false, error: "invalid", fieldErrors: z.flattenError(parsed.error).fieldErrors as Record<string, string[]> };
    }
    const input = toPaymentInput(parsed.data, digits);
    const result = await recordPayment(scope, id, { ...input, userId: merchant.session.user.id });
    if (result.ok) return result;
    if (!("limitMinor" in result)) return { ok: false, error: result.error };
    // The limit changed since the form was filled (or the browser skipped its check)
    const limit = {
      dueMinor: result.limitMinor,
      netMinor: result.limitMinor,
      format: (minor: number) => formatMoney(minor, currency, locale),
    };
    return { ok: false, error: "invalid", fieldErrors: { amount: [paymentLimitMessage(t, input.kind, input.amountMinor, limit)!] } };
  } catch (error) {
    console.error("recordPayment failed", error);
    return { ok: false, error: "failed" };
  }
}

/** Removes a payment record entered by mistake (see deletePayment); needs `payment:delete`. */
export async function deletePaymentAction(orderId: unknown, paymentId: unknown): Promise<PaymentActionResult> {
  const merchant = await getMerchantOrNull();
  if (!merchant || !merchant.can({ order: ["read"], payment: ["delete"] })) return { ok: false, error: "forbidden" };
  const parsedOrder = z.uuid().safeParse(orderId);
  const parsedPayment = z.uuid().safeParse(paymentId);
  if (!parsedOrder.success || !parsedPayment.success) return { ok: false, error: "notFound" };
  try {
    return await deletePayment(
      { tenantId: merchant.tenantId, storeId: merchant.store.id },
      parsedOrder.data.toLowerCase(),
      parsedPayment.data.toLowerCase(),
    );
  } catch (error) {
    console.error("deletePayment failed", error);
    return { ok: false, error: "failed" };
  }
}
