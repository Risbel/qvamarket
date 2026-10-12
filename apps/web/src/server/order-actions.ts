"use server";

import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { routing } from "@/i18n/routing";
import { createOrderStatusSchema } from "@/lib/validation/order-status";
import { changeOrderStatus } from "./orders";
import { getMerchantOrNull } from "./tenant";

export type OrderStatusActionResult =
  | { ok: true; restockedUnits: number }
  | {
      ok: false;
      error: "forbidden" | "notFound" | "invalid" | "stale" | "notAllowed" | "failed";
      fieldErrors?: Record<string, string[]>;
    };

/** Changes an order's status (see changeOrderStatus); needs `order:update`. */
export async function changeOrderStatusAction(
  orderId: unknown,
  values: unknown,
  locale: string,
): Promise<OrderStatusActionResult> {
  const merchant = await getMerchantOrNull();
  if (!merchant || !merchant.can({ order: ["update"] })) return { ok: false, error: "forbidden" };
  const parsedId = z.uuid().safeParse(orderId);
  if (!parsedId.success) return { ok: false, error: "notFound" };
  const t = await getTranslations({
    locale: hasLocale(routing.locales, locale) ? locale : routing.defaultLocale,
    namespace: "Validation",
  });
  const parsed = createOrderStatusSchema(t).safeParse(values);
  if (!parsed.success) {
    return { ok: false, error: "invalid", fieldErrors: z.flattenError(parsed.error).fieldErrors as Record<string, string[]> };
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
